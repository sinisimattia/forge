import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { I18nValidationPipe } from 'nestjs-i18n';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters';
import { I18nResponseInterceptor } from './common/interceptors';

// No global route prefix: `/health` is polled directly (by the container
// healthcheck and by the e2e smoke test), unprefixed.
async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const config = app.get(ConfigService);

  app.useGlobalPipes(
    new I18nValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalInterceptors(new I18nResponseInterceptor());

  app.useGlobalFilters(new HttpExceptionFilter());

  const corsOrigin = config.get<string>('CORS_ORIGIN', 'http://localhost:3001');
  app.enableCors({ origin: corsOrigin, credentials: true });

  const port = config.get<number>('PORT', 3000);
  await app.listen(port);
}

bootstrap();
