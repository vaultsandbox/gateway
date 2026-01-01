import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import { APP_GUARD } from '@nestjs/core';
import { join } from 'path';
import { AppController } from './app.controller';
import appConfig from './app.config';
import { HealthModule } from './health/health.module';
import { OrchestrationModule } from './orchestration/orchestration.module';
import { CertificateModule } from './certificate/certificate.module';
import { CryptoModule } from './crypto/crypto.module';
import { InboxModule } from './inbox/inbox.module';
import { SmtpModule } from './smtp/smtp.module';
import { MetricsModule } from './metrics/metrics.module';
import { ServerModule } from './server/server.module';
import { RedirectToHttpsMiddleware } from './server/redirect-to-https.middleware';
import { SecurityHeadersMiddleware } from './server/security-headers.middleware';
import { EventsModule } from './events/events.module';
import { SseConsoleModule } from './sse-console/sse-console.module';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { DEFAULT_GATEWAY_MODE } from './config/config.constants';
import { TestModule } from './test/test.module';

// Conditional module loading based on gateway mode
const gatewayMode = process.env.VSB_GATEWAY_MODE || DEFAULT_GATEWAY_MODE;
const isDevelopment = process.env.VSB_DEVELOPMENT === 'true';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig],
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            ttl: config.get<number>('vsb.throttle.ttl') ?? 60000,
            limit: config.get<number>('vsb.throttle.limit') ?? 100,
          },
        ],
      }),
    }),
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    // Serve Angular frontend at /app endpoint
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', '..', 'frontend', 'dist', 'frontend', 'browser'),
      serveRoot: '/app',
      exclude: ['/api/{*path}', '/health/{*path}', '/.well-known/{*path}', '/cluster/{*path}'],
    }),
    ServerModule,
    SmtpModule,
    HealthModule,
    OrchestrationModule,
    CertificateModule,
    CryptoModule,
    MetricsModule,
    SseConsoleModule, // Always import, enabled/disabled via config
    // Conditionally import InboxModule only in local mode
    ...(gatewayMode === 'local' ? [InboxModule, EventsModule] : []),
    // Conditionally import TestModule only in local mode with VSB_DEVELOPMENT=true
    ...(gatewayMode === 'local' && isDevelopment ? [TestModule] : []),
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Apply redirect middleware to all routes
    // The middleware itself checks if the request is already on HTTPS
    // and has exceptions for ACME challenges, cluster endpoints, and health checks
    consumer.apply(RedirectToHttpsMiddleware).forRoutes('*');

    // Apply security headers to HTML-serving routes (index and Angular app)
    consumer.apply(SecurityHeadersMiddleware).forRoutes('/', '/app', '/app/(.*)');
  }
}
