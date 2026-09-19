import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

// No global route prefix: `/health` is polled directly (by the container
// healthcheck and by the e2e smoke test), unprefixed.
//
// Deliberately almost empty. Every line here is one no test can see — `main.ts`
// runs only under `node` and is excluded from coverage — so the configuration
// lives in `configureApp` and in `AppModule`'s `APP_*` providers, both of which
// a spec can reach. See `app.setup.ts` for what that cost when it was not true.
async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  configureApp(app);

  const port = app.get(ConfigService).get<number>('PORT', 3000);
  await app.listen(port);
}

bootstrap();
