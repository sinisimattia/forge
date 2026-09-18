import { Controller, Get, INestApplication } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { SessionId } from '__FORGE_SCOPE__/core/auth/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import { AppModule } from '../../app.module';
import { Public } from '../decorators';
import { JwtAuthGuard } from '../guards';
import type { AccessTokenClaims } from '../session/session.service';
import { JwtStrategy } from '../strategies';

/**
 * # D6 — a new endpoint is protected unless it says otherwise
 *
 * This is the assertion that every other security property in this application
 * rests on, and it is about code that does not exist yet: the endpoint somebody
 * adds next year, in a hurry, without thinking about authentication.
 *
 * **The controller below is defined inside this file on purpose, and the
 * suite is worthless without that.** Pointing the assertion at a real
 * endpoint would prove only that *that* endpoint is decorated correctly — a
 * fact about one file, which stays true while `APP_GUARD` is deleted and every
 * other route in the application swings open. `ProbeController.undecorated`
 * carries no decorator of any kind beyond the routing, so nothing about it can
 * be the reason it is refused. The only thing that can refuse it is a guard
 * registered for the whole application.
 *
 * Watched failing: with the `APP_GUARD` provider removed from the testing module,
 * `undecorated` answers `200`.
 *
 * **And that is only half of it.** Everything below registers its own
 * `APP_GUARD`, so all of it stays green while `app.module.ts` — the module the
 * application actually boots — loses the provider entirely. That was measured:
 * deleting it there left `tsc`, `eslint` and all 164 tests passing, with every
 * endpoint open. The first assertion in this file exists for exactly that, and
 * it is the one that speaks about the shipped application rather than about a
 * module a test built.
 */
@Controller('probe')
class ProbeController {
  /**
   * No decorators at all. This is a stand-in for every endpoint this project
   * will ever grow, written by somebody who was not thinking about the guard.
   */
  @Get('undecorated')
  public undecorated(): { reached: true } {
    return { reached: true };
  }

  /** The deliberate exception, written down where a reviewer sees it. */
  @Public()
  @Get('marked')
  public marked(): { reached: true } {
    return { reached: true };
  }
}

/** This suite's signing key. Not a credential: it signs nothing outside this file. */
const SIGNING_KEY = 'global-guard-spec-signing-key';

/** A different one, used to forge a well-formed credential this app did not mint. */
const FOREIGN_KEY = 'a-key-this-application-never-had';

const ACTOR: AccessTokenClaims = {
  sub: '11111111-1111-4111-8111-111111111111' as UserId,
  sid: '22222222-2222-4222-8222-222222222222' as SessionId,
};

describe('D6: the global guard closes every route that does not open itself', () => {
  // Read off the module's own metadata rather than by starting it: `AppModule`
  // opens a database connection, and this assertion is about what the module
  // declares, which is knowable without one.
  it('is registered by AppModule itself, not only by this suite', () => {
    const providers: unknown[] = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, AppModule) ?? [];

    expect(providers).toContainEqual({ provide: APP_GUARD, useClass: JwtAuthGuard });
  });

  let app: INestApplication;
  let jwt: JwtService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          load: [() => ({ JWT_SECRET: SIGNING_KEY })],
        }),
        PassportModule,
        JwtModule.register({ secret: SIGNING_KEY, signOptions: { expiresIn: '5m' } }),
      ],
      controllers: [ProbeController],
      providers: [
        JwtStrategy,
        // THE LINE UNDER TEST. `app.module.ts` carries the same provider, and
        // deleting it there breaks no type and fails no lint rule.
        { provide: APP_GUARD, useClass: JwtAuthGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    jwt = moduleRef.get(JwtService);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  // The assertion that matters. A developer who adds an endpoint and forgets to
  // think about authentication gets a closed door, not an open one.
  it('refuses an undecorated route presented with no credential', async () => {
    await request(app.getHttpServer()).get('/probe/undecorated').expect(401);
  });

  // Without this, the suite above would pass against a guard that refuses
  // everything unconditionally — which is not a guard, it is an outage.
  it('admits the same undecorated route when a valid credential is presented', async () => {
    const credential = jwt.sign(ACTOR);

    await request(app.getHttpServer())
      .get('/probe/undecorated')
      .set('Authorization', `Bearer ${credential}`)
      .expect(200, { reached: true });
  });

  // And without this one, both of the above would pass against a guard that only
  // checked whether an `Authorization` header was present.
  it('refuses a well-formed credential this application did not sign', async () => {
    const forged = new JwtService({ secret: FOREIGN_KEY }).sign(ACTOR);

    await request(app.getHttpServer())
      .get('/probe/undecorated')
      .set('Authorization', `Bearer ${forged}`)
      .expect(401);
  });

  it('admits a route marked @Public() with no credential', async () => {
    await request(app.getHttpServer()).get('/probe/marked').expect(200, { reached: true });
  });
});
