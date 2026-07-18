import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NextFunction, Request, Response } from 'express';
import { createProxyMiddleware, fixRequestBody } from 'http-proxy-middleware';
import type { RequestHandler as ProxyRequestHandler } from 'http-proxy-middleware';
import { JwtVerifierService } from '../auth/jwt-verifier.service';
import { SlidingWindowRateLimiterService } from '../rate-limit/sliding-window-rate-limiter.service';
import { AppConfig } from '../config/configuration';
import { isAuthRateLimitScope, resolveRoute, stripApiPrefix } from './route-table';
import { RequestUser } from '@oneandro/common';

interface TimedRequest extends Request {
  _gatewayStart?: number;
  user?: RequestUser;
}

function errorBody(status: number, error: string, message: string, path: string) {
  return { statusCode: status, error, message, path, timestamp: new Date().toISOString() };
}

/**
 * The whole gateway pipeline lives in one middleware, applied to every
 * route (see AppModule#configure). That's deliberate, not an accident of
 * convenience: auth resolution, rate limiting, and proxying all have to
 * run *in that order* before a proxied request's body starts streaming to
 * the target, and Nest's guard/interceptor stack doesn't apply to routes
 * that never reach a controller (which is every proxied route — there is
 * no NestJS handler for "forward this to lead-service"). Splitting this
 * into a guard + a separately-mounted proxy middleware would reintroduce
 * exactly the ordering ambiguity this design avoids.
 */
@Injectable()
export class GatewayMiddleware implements NestMiddleware {
  private readonly logger = new Logger(GatewayMiddleware.name);
  private readonly apiPrefix: string;
  private readonly userServiceProxy: ProxyRequestHandler;
  private readonly leadServiceProxy: ProxyRequestHandler;
  private readonly aiOrchestratorProxy: ProxyRequestHandler;

  constructor(
    private readonly configService: ConfigService<AppConfig, true>,
    private readonly jwtVerifier: JwtVerifierService,
    private readonly rateLimiter: SlidingWindowRateLimiterService,
  ) {
    this.apiPrefix = this.configService.get('apiPrefix', { infer: true });

    this.userServiceProxy = this.buildProxy('user-service', this.configService.get('services.userServiceUrl', { infer: true }));
    this.leadServiceProxy = this.buildProxy('lead-service', this.configService.get('services.leadServiceUrl', { infer: true }));
    this.aiOrchestratorProxy = this.buildProxy(
      'ai-orchestrator',
      this.configService.get('services.aiOrchestratorUrl', { infer: true }),
    );
  }

  /**
   * req.url is already rewritten to the downstream-facing path (prefix
   * stripped) by the time any of these run — see use() below — so there's
   * no pathRewrite here. Each proxy only ever talks to one fixed target.
   */
  private buildProxy(name: string, target: string): ProxyRequestHandler {
    return createProxyMiddleware({
      target,
      changeOrigin: true,
      on: {
        proxyReq: (proxyReq, req) => {
          const requestId = (req as Request).headers['x-request-id'];
          if (requestId) proxyReq.setHeader('x-request-id', requestId);

          // NestJS's global body parser (applied ahead of every
          // middleware, including this one) already fully consumed the
          // incoming request stream to populate req.body — so there is
          // nothing left for http-proxy-middleware's normal stream-piping
          // to forward. Without this, any proxied request WITH a body
          // (every non-GET auth/leads/ai call) hangs forever: the
          // upstream request goes out with a Content-Length promising a
          // body that never arrives, so the target never responds and
          // this proxy never errors either — it just sits there. This
          // hit a real CI run: GET /healthz (no body) always worked, but
          // the very first POST (auth/register) hung for the full 30s
          // nginx timeout with zero logs anywhere. fixRequestBody
          // re-serializes req.body onto the outgoing request when the
          // source stream was already drained.
          fixRequestBody(proxyReq, req as Request);
        },
        proxyRes: (proxyRes, req) => {
          const started = (req as TimedRequest)._gatewayStart;
          const ms = started ? Date.now() - started : -1;
          this.logger.log(`${req.method} ${req.url} -> ${name} ${proxyRes.statusCode} ${ms}ms`);
        },
        error: (err, req, res) => {
          this.logger.error(`proxy error forwarding to ${name}: ${err.message}`);
          // `res` is typed as ServerResponse | Socket (the latter only for
          // failed WS upgrades, which this gateway never proxies). A plain
          // net.Socket has neither `headersSent` nor `status` — check for
          // both rather than trusting the union, then cast.
          if ('headersSent' in res && 'status' in res) {
            const expressRes = res as unknown as Response;
            if (!expressRes.headersSent) {
              expressRes.status(502).json(errorBody(502, 'Bad Gateway', `${name} is unavailable`, (req as Request).url));
            }
          }
        },
      },
    });
  }

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    (req as TimedRequest)._gatewayStart = Date.now();

    const strippedPath = stripApiPrefix(req.path, this.apiPrefix);
    const route = resolveRoute(strippedPath);

    if (route.kind === 'not-found') {
      res.status(404).json(errorBody(404, 'Not Found', `No route for ${strippedPath}`, req.originalUrl));
      return;
    }

    // Rewrite so both Nest's own router (for /dashboard) and the proxy
    // targets (for everything else) see the clean, downstream-facing path.
    const queryIndex = req.url.indexOf('?');
    req.url = queryIndex === -1 ? strippedPath : strippedPath + req.url.slice(queryIndex);

    if (strippedPath === '/healthz') {
      next();
      return;
    }

    const rawToken = JwtVerifierService.extractToken(req.cookies, req.headers.authorization);
    const user = await this.jwtVerifier.tryVerify(rawToken);
    if (user) {
      (req as TimedRequest).user = user;
    }

    const scope = isAuthRateLimitScope(strippedPath) ? 'auth' : 'general';
    const identity = scope === 'auth' ? req.ip : (user?.userId ?? req.ip);
    const limit =
      scope === 'auth'
        ? this.configService.get('rateLimit.authMaxRequests', { infer: true })
        : this.configService.get('rateLimit.generalMaxRequests', { infer: true });
    const windowMs = this.configService.get('rateLimit.windowMs', { infer: true });

    const decision = await this.rateLimiter.consume(scope, identity ?? 'unknown', limit, windowMs);

    res.setHeader('X-RateLimit-Limit', String(decision.limit));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, decision.remaining)));

    if (!decision.allowed) {
      const retryAfterSeconds = Math.ceil(decision.retryAfterMs / 1000);
      res.setHeader('Retry-After', String(retryAfterSeconds));
      res
        .status(429)
        .json(
          errorBody(
            429,
            'Too Many Requests',
            `Rate limit exceeded for ${scope} requests. Retry in ${retryAfterSeconds}s.`,
            req.originalUrl,
          ),
        );
      return;
    }

    if (route.kind === 'local') {
      next();
      return;
    }

    const proxy =
      route.service === 'user' ? this.userServiceProxy : route.service === 'lead' ? this.leadServiceProxy : this.aiOrchestratorProxy;

    await proxy(req, res, next);
  }
}
