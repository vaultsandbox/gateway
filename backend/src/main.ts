import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { Logger, ValidationPipe } from '@nestjs/common';
import { HttpServerService } from './server/http-server.service';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { logConfigurationSummary } from './config/config.utils';
import type { VsbConfiguration } from './config/config.types';
import type { Request, Response, NextFunction } from 'express';
import { vsxDnsPreBoot } from './vsx-dns-preboot';

/**
 * BootStrap
 */
async function bootstrap() {
  const logger = new Logger('bootstrap');

  try {
    // VSX DNS pre-boot: check-in and populate env vars before NestJS loads config
    await vsxDnsPreBoot();

    // Create NestJS app but don't call listen() - we'll manage servers manually
    const isDevelopment = process.env.NODE_ENV === 'development';
    const app = await NestFactory.create<NestExpressApplication>(AppModule, {
      logger: isDevelopment ? ['log', 'error', 'warn', 'debug', 'verbose'] : ['log', 'error', 'warn'],
    });

    // Enable global validation pipe for DTO validation
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true, // Strip properties not in DTO
        forbidNonWhitelisted: true, // Reject requests with extra properties
        transform: true, // Transform payloads to DTO instances
      }),
    );

    app.enableShutdownHooks();

    const config = app.get<ConfigService>(ConfigService);
    const httpServerService = app.get<HttpServerService>(HttpServerService);

    const httpPort = config.get<number>('vsb.main.port');
    const httpsPort = config.get<number>('vsb.main.httpsPort');
    const httpsEnabled = config.get<boolean>('vsb.main.httpsEnabled');
    const environment = config.get<string>('vsb.environment');

    const shutdown = async (signal: string) => {
      logger.log(`Received ${signal}, starting graceful shutdown`);
      try {
        await app.close();
        logger.log('Application closed successfully');
        process.exit(0);
      } catch (shutdownError) {
        const message = shutdownError instanceof Error ? shutdownError.message : String(shutdownError);
        const stack = shutdownError instanceof Error ? shutdownError.stack : undefined;
        logger.error(`Error during shutdown: ${message}`, stack);
        process.exit(1);
      }
    };

    const handleSignal = (signal: NodeJS.Signals) => {
      void shutdown(signal);
    };

    process.on('SIGTERM', handleSignal);
    process.on('SIGINT', handleSignal);

    // Handle CORS and Swagger
    if (environment === 'development') {
      app.enableCors();
      logger.log(`RUNNING IN DEVELOPMENT MODE`);

      // Log configuration summary in development mode
      const vsbConfig = config.get<VsbConfiguration>('vsb');
      if (vsbConfig) {
        logConfigurationSummary(vsbConfig);
      }

      const swaggerConfig = new DocumentBuilder()
        .setTitle('VaultSandbox Gateway API')
        .setDescription('The API documentation for the VaultSandbox Gateway.')
        .setVersion('1.0')
        .addApiKey({ type: 'apiKey', name: 'X-API-Key', in: 'header' }, 'api-key')
        .build();
      const document = SwaggerModule.createDocument(app, swaggerConfig);
      SwaggerModule.setup('api-docs', app, document);
      logger.log('Swagger UI is available at /api-docs');
    } else {
      const origin = config.get('vsb.main.origin') as string;
      app.enableCors({ origin: origin });
      logger.log(`Accepting requests from origin "${origin}"`);
    }

    // Add HSTS middleware for HTTPS connections
    if (httpsEnabled) {
      app.use((req: Request, res: Response, next: NextFunction) => {
        // Only set HSTS header on secure connections
        if (req.secure) {
          res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        }
        next();
      });
      logger.log('HSTS middleware enabled for secure connections');
    }

    // Initialize the app (triggers OnModuleInit lifecycle hooks)
    await app.init();

    if (!httpPort) {
      logger.error('NO HTTP PORT CONFIGURED (VSB_SERVER_PORT)');
      return;
    }

    logger.log(`Starting VaultSandbox Gateway`);
    logger.log(`HTTP port: ${httpPort}`);
    logger.log(`HTTPS enabled: ${httpsEnabled}`);
    if (httpsEnabled) {
      logger.log(`HTTPS port: ${httpsPort}`);
    }

    // Initialize and start both HTTP and HTTPS servers
    await httpServerService.initializeServers(app);

    logger.log('VaultSandbox Gateway is ready');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    logger.error(`Failed to bootstrap application: ${errorMessage}`, errorStack);
    process.exit(1);
  }
}
bootstrap().catch((error) => {
  const logger = new Logger('bootstrap');
  const errorMessage = error instanceof Error ? error.message : String(error);
  logger.error(`Unhandled bootstrap error: ${errorMessage}`);
  process.exit(1);
});
