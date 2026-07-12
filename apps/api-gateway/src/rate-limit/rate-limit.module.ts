import { Global, Module } from '@nestjs/common';
import { SlidingWindowRateLimiterService } from './sliding-window-rate-limiter.service';

@Global()
@Module({
  providers: [SlidingWindowRateLimiterService],
  exports: [SlidingWindowRateLimiterService],
})
export class RateLimitModule {}
