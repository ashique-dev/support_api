import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AnalyticsService, REDIS_CLIENT } from './analytics.service';
import { AnalyticsController } from './analytics.controller';
import Redis from 'ioredis';

@Module({
  imports: [ConfigModule],
  controllers: [AnalyticsController],
  providers: [
    // ── Manual Redis client for fine-grained control ──────────────────────
    // We use ioredis directly (not cache-manager) because analytics needs
    // pipeline(), zremrangebyscore(), sorted sets – features not in cache-manager.
    {
      provide: REDIS_CLIENT,
      useFactory: (config: ConfigService): Redis => {
        const client = new Redis({
          host: config.get('redis.host'),
          port: config.get<number>('redis.port'),
          password: config.get('redis.password'),
          retryStrategy: (times) => Math.min(times * 50, 2000),
          lazyConnect: false,
          enableOfflineQueue: true,
        });

        client.on('connect', () => console.log('✓ Redis connected'));
        client.on('error', (err) => console.error('Redis error:', err.message));

        return client;
      },
      inject: [ConfigService],
    },
    AnalyticsService,
  ],
  exports: [AnalyticsService, REDIS_CLIENT],
})
export class AnalyticsModule {}
