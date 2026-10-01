import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

// No global route prefix: the health endpoints are polled directly, unprefixed,
// by the container healthcheck (which polls readiness) and by smoke tests.
//
// Deliberately almost empty, and NOT protected: every line here is one no test
// can see. `main.ts` is excluded from coverage (`jest.config.ts`: `'!main.ts'`)
// and no spec imports it, so anything added below — a second `enableCors`, a
// changed default, a deleted `listen` — is invisible to the whole suite. That
// was measured, not assumed.
//
// So configuration goes in `configureApp` or in `AppModule`'s `APP_*` providers,
// both of which a spec reaches, and this function stays four statements long. See
// `app.setup.ts` for what it cost when four of these lines lived here.
async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  configureApp(app);

  const port = app.get(ConfigService).get<number>('PORT', 3000);
  await app.listen(port);
}

bootstrap();
