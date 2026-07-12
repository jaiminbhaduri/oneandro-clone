export type RouteTarget =
  | { kind: 'proxy'; service: 'user' | 'lead' | 'ai' }
  | { kind: 'local' }
  | { kind: 'not-found' };

/**
 * Everything under /auth and /users belongs to user-service, /leads to
 * lead-service, /ai to ai-orchestrator. /dashboard and /healthz are
 * handled locally by this service (aggregation + own health, respectively).
 * Kept as a pure function so routing decisions are unit-testable without
 * spinning up Express or http-proxy-middleware.
 */
export function resolveRoute(strippedPath: string): RouteTarget {
  if (strippedPath === '/healthz') return { kind: 'local' };
  if (strippedPath === '/dashboard' || strippedPath.startsWith('/dashboard/')) return { kind: 'local' };
  if (strippedPath === '/auth' || strippedPath.startsWith('/auth/')) return { kind: 'proxy', service: 'user' };
  if (strippedPath === '/users' || strippedPath.startsWith('/users/')) return { kind: 'proxy', service: 'user' };
  if (strippedPath === '/leads' || strippedPath.startsWith('/leads/')) return { kind: 'proxy', service: 'lead' };
  if (strippedPath === '/ai' || strippedPath.startsWith('/ai/')) return { kind: 'proxy', service: 'ai' };
  return { kind: 'not-found' };
}

/** Matches the tight Nginx `edge_auth` zone in infra/nginx/conf.d/default.conf — brute-force-sensitive endpoints get the tiny quota, IP-keyed. */
export function isAuthRateLimitScope(strippedPath: string): boolean {
  return strippedPath === '/auth/login' || strippedPath === '/auth/refresh';
}

/**
 * Nginx forwards the full incoming URI unchanged (no prefix stripping at
 * the edge — see infra/nginx/conf.d/default.conf), so every request
 * arrives here as e.g. "/api/v1/leads/123". Downstream services expose
 * clean paths ("/leads/123"); this is the one place that translates
 * between the two.
 */
export function stripApiPrefix(path: string, prefix: string): string {
  if (path === prefix) return '/';
  if (path.startsWith(`${prefix}/`)) return path.slice(prefix.length) || '/';
  return path; // no prefix present — pass through unchanged (defensive; shouldn't happen via Nginx)
}
