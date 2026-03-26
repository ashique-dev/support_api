import { Injectable, NestMiddleware, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../analytics/analytics.service';

interface RateLimitConfig {
  windowMs: number;
  limit: number;
  keyPrefix: string;
}

@Injectable()
export class SlidingWindowRateLimiterMiddleware implements NestMiddleware {
  constructor(@Inject(REDIS_CLIENT) private redis: Redis) {}

  // ─── Sliding Window Algorithm ─────────────────────────────────────────────
  //
  // Unlike a fixed window (which resets the counter at a fixed interval,
  // allowing 2x the limit at window boundaries), the sliding window tracks
  // exact request timestamps in a Redis Sorted Set.
  //
  // Data structure:
  //   Key:    "ratelimit:{prefix}:{identifier}"
  //   Type:   Sorted Set
  //   Member: unique request ID (uuid or timestamp + rand)
  //   Score:  Unix timestamp in milliseconds (used for range queries)
  //
  // Per-request flow (atomic via pipeline):
  //   1. ZREMRANGEBYSCORE key -inf (now - windowMs)   → evict old entries
  //   2. ZCARD key                                     → count active requests
  //   3. ZADD key now requestId                        → record this request
  //   4. PEXPIRE key windowMs                          → auto-cleanup
  //
  async checkLimit(
    identifier: string,
    config: RateLimitConfig,
  ): Promise<{ allowed: boolean; remaining: number; retryAfter: number }> {
    const now = Date.now();
    const windowStart = now - config.windowMs;
    const key = `ratelimit:${config.keyPrefix}:${identifier}`;
    const requestId = `${now}:${Math.random().toString(36).slice(2)}`;

    // Atomic pipeline – all commands execute in one round trip
    const pipeline = this.redis.pipeline();
    pipeline.zremrangebyscore(key, '-inf', windowStart);   // 1. Evict expired
    pipeline.zcard(key);                                    // 2. Count current
    pipeline.zadd(key, 'NX', now, requestId);              // 3. Add this request
    pipeline.pexpire(key, config.windowMs);                 // 4. Auto-cleanup TTL

    const results = await pipeline.exec();

    // results[1] is the ZCARD result (count before this request was added)
    const currentCount = (results[1]?.[1] as number) ?? 0;
    const allowed = currentCount < config.limit;
    const remaining = Math.max(0, config.limit - currentCount - 1);

    // If rate limited, find the oldest entry's score (when the window will slide past it)
    let retryAfter = 0;
    if (!allowed) {
      const oldest = await this.redis.zrange(key, 0, 0, 'WITHSCORES');
      if (oldest.length >= 2) {
        const oldestTs = parseInt(oldest[1], 10);
        retryAfter = Math.ceil((oldestTs + config.windowMs - now) / 1000);
      }
    }

    return { allowed, remaining, retryAfter };
  }

  use(req: Request, res: Response, next: NextFunction) {
    // Default middleware doesn't apply; use applyTo() for specific routes
    next();
  }

  // ─── Factory: returns a middleware function for a specific config ──────────
  forRoute(config: RateLimitConfig) {
    return async (req: Request, res: Response, next: NextFunction) => {
      // Use IP + userId (if authenticated) as identifier for precision
      const userId = (req as any).user?.id;
      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      const identifier = userId ? `user:${userId}` : `ip:${ip}`;

      const { allowed, remaining, retryAfter } = await this.checkLimit(identifier, config);

      // Set standard rate-limit response headers
      res.setHeader('X-RateLimit-Limit', config.limit);
      res.setHeader('X-RateLimit-Remaining', remaining);
      res.setHeader('X-RateLimit-Window-Ms', config.windowMs);

      if (!allowed) {
        res.setHeader('Retry-After', retryAfter);
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: `Rate limit exceeded. Try again in ${retryAfter}s.`,
            retryAfter,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      next();
    };
  }
}
