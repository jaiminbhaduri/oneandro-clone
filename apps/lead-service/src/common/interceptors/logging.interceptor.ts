import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const requestId = (request.headers['x-request-id'] as string) ?? '-';
    const started = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          this.logger.log(
            `${request.method} ${request.originalUrl} ${response.statusCode} ${Date.now() - started}ms [${requestId}]`,
          );
        },
        error: (err: Error) => {
          this.logger.warn(
            `${request.method} ${request.originalUrl} FAILED ${Date.now() - started}ms [${requestId}] ${err.message}`,
          );
        },
      }),
    );
  }
}
