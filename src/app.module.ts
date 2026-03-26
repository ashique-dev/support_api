import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bull';
import { APP_GUARD } from '@nestjs/core';
import configuration from './config/configuration';
import { SnakeCaseNamingStrategy } from './database/snake-case-naming.strategy';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { TenantsModule } from './tenants/tenants.module';
import { ConversationsModule } from './conversations/conversations.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { WorkersModule } from './workers/workers.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';

@Module({
  imports: [
    // ─── Configuration ──────────────────────────────────────────────────────
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),

    // ─── Database ───────────────────────────────────────────────────────────
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get('database.host'),
        port: config.get<number>('database.port'),
        username: config.get('database.username'),
        password: config.get('database.password'),
        database: config.get('database.name'),
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        migrations: [__dirname + '/database/migrations/**/*{.ts,.js}'],
        synchronize: config.get('nodeEnv') === 'development',
        namingStrategy: new SnakeCaseNamingStrategy(),
        logging: config.get('nodeEnv') === 'development',
        extra: {
          // PostgreSQL connection pool settings
          max: 20,
          idleTimeoutMillis: 30_000,
          connectionTimeoutMillis: 2_000,
        },
      }),
      inject: [ConfigService],
    }),

    // ─── Rate Limiting (Sliding Window via Redis) ────────────────────────────
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            name: 'global',
            ttl: config.get<number>('throttle.ttl') * 1000,
            limit: config.get<number>('throttle.limit'),
          },
          {
            name: 'auth',       // Stricter limits for auth endpoints
            ttl: 60 * 1000,    // 1 minute
            limit: 5,
          },
          {
            name: 'conversation', // Per-conversation creation
            ttl: 60 * 1000,
            limit: 20,
          },
        ],
      }),
      inject: [ConfigService],
    }),

    // ─── Bull / BullMQ Queue ─────────────────────────────────────────────────
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        redis: {
          host: config.get('redis.host'),
          port: config.get<number>('redis.port'),
          password: config.get('redis.password'),
        },
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 1000,
          },
          removeOnComplete: true,
          removeOnFail: false,
        },
      }),
      inject: [ConfigService],
    }),

    // ─── Feature Modules ─────────────────────────────────────────────────────
    AuthModule,
    UsersModule,
    TenantsModule,
    ConversationsModule,
    AnalyticsModule,
    WorkersModule,
  ],
  providers: [
    // Apply JWT guard globally – all routes require auth by default
    // Use @Public() decorator to opt out
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    // Apply throttler globally
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
