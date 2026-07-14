import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import configuration from './config/configuration';
import { AuthModule } from './auth/auth.module';
import { RateLimitModule } from './rate-limit/rate-limit.module';
import { ProxyModule } from './proxy/proxy.module';
import { GatewayMiddleware } from './proxy/gateway.middleware';
import { HealthModule } from './health/health.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    AuthModule,
    RateLimitModule,
    ProxyModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Every request — proxied or locally-handled — passes through the
    // gateway pipeline first. See GatewayMiddleware's docstring for why
    // this isn't split into a guard + separately-mounted proxy.
    //
    // '/' rather than '*': under Express 5, a wildcard mount path (even
    // after Nest's own '*' -> '{*path}' legacy conversion) makes Express
    // treat the ENTIRE matched path as a "mount prefix" that gets
    // stripped before this middleware runs and re-prepended after next()
    // is called — which corrupts req.url the moment this middleware
    // reassigns it (see GatewayMiddleware#use). Mounting at the exact
    // path '/' still matches every request (all paths start with '/'),
    // but the matched prefix has zero length, so Express never strips or
    // restores anything — req.url stays exactly what this middleware
    // sets it to.
    consumer.apply(GatewayMiddleware).forRoutes('/');
  }
}
