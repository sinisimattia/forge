import { Module, Provider } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, JwtModuleOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { AuthIdentityRecord } from '../identities/auth-identity-record.entity';
import { IdentitiesController } from '../identities/identities.controller';
import { IdentitiesModule } from '../identities/identities.module';
import { MailModule } from '../mail';
import { UserRecord } from '../users/user-record.entity';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { EmailVerificationTokenRecord } from './entities/email-verification-token-record.entity';
import { PasswordResetTokenRecord } from './entities/password-reset-token-record.entity';
import { RefreshTokenRecord } from './entities/refresh-token-record.entity';
import { SessionRecord } from './entities/session-record.entity';
import { JwtAuthGuard } from './guards';
import type { IOAuthProvider } from './oauth/IOAuthProvider';
import { OAUTH_PROVIDERS } from './oauth/IOAuthProvider';
import { OAuthAuthorizationRequestRecord } from './oauth/oauth-authorization-request.entity';
import { OAuthProviderRegistry } from './oauth/oauth-provider.registry';
import { buildOAuthProviders } from './oauth/oauth.config';
import { OAuthController } from './oauth/oauth.controller';
import { OAuthService } from './oauth/oauth.service';
import { RefreshTokenService } from './session/refresh-token.service';
import { ACCESS_TOKEN_TTL_SECONDS, SessionService } from './session/session.service';
import { JwtStrategy } from './strategies';

/**
 * Which providers this deployment has, decided once and provided under
 * {@link OAUTH_PROVIDERS} — the multi-provider token every adapter Task 12's
 * `OAuthService` resolves through `OAuthProviderRegistry` is injected as.
 *
 * A named export for the reason {@link accessTokenSigningOptions} is one: a
 * spec can call the exact factory the module uses, and `composition-root.spec.ts`
 * pins that the module uses this value rather than an inlined copy.
 */
export const OAUTH_PROVIDERS_PROVIDER: Provider = {
  provide: OAUTH_PROVIDERS,
  useFactory: buildOAuthProviders,
  inject: [ConfigService],
};

/**
 * Built from whatever {@link OAUTH_PROVIDERS_PROVIDER} produced —
 * `OAuthProviderRegistry` carries no `@Injectable()` of its own (every spec in
 * `auth/oauth/__tests__` constructs it with `new`), so this explicit factory is
 * the only way Nest resolves it as the type-token `OAuthService`'s constructor
 * names.
 */
export const OAUTH_PROVIDER_REGISTRY_PROVIDER: Provider = {
  provide: OAuthProviderRegistry,
  useFactory: (providers: IOAuthProvider[]): OAuthProviderRegistry =>
    new OAuthProviderRegistry(providers),
  inject: [OAUTH_PROVIDERS],
};

/**
 * How access credentials are signed.
 *
 * A named, exported function rather than an inline `useFactory`, so a spec can
 * call it — an inline one is unreachable from any test, and both of the things
 * it decides are security decisions. A review changed `getOrThrow` to
 * `get('JWT_SECRET', 'dev-fallback-signing-key')` and `expiresIn` to `'365d'`
 * while it was inline, and all 165 tests stayed green for both.
 *
 * `getOrThrow` with no default, anywhere: a fallback signing key is a key every
 * project generated from this template would share, and whoever holds it can
 * mint a credential for any account on any of them. The deployment fails to boot
 * instead, which is the loud failure.
 *
 * `expiresIn` is the lifetime the whole revocation story rests on — nothing is
 * looked up when an access credential is presented, so this number IS the window
 * in which a revoked session keeps working. See
 * {@link ACCESS_TOKEN_TTL_SECONDS} and `strategies/jwt.strategy.ts`.
 *
 * @param config - the configuration this deployment was started with
 * @returns the options `JwtModule` is registered with
 * @throws when `JWT_SECRET` is not configured
 */
export function accessTokenSigningOptions(config: ConfigService): JwtModuleOptions {
  return {
    secret: config.getOrThrow<string>('JWT_SECRET'),
    signOptions: { expiresIn: ACCESS_TOKEN_TTL_SECONDS },
  };
}

/**
 * Registration, authentication and the session lifecycle.
 *
 * The password hasher and the breached-password registry were bound here while
 * this was their only consumer. They are `IdentitiesModule`'s now, which owns
 * the rows they write into and has a surface of its own — the same reason
 * `MAILER` has always had its own module.
 *
 * `JwtAuthGuard` is provided here as an ordinary class and registered as the
 * application-wide guard in `app.module.ts`. It is deliberately **not**
 * registered as `APP_GUARD` from this module: a module-level `APP_GUARD` still
 * applies globally, which would put the single most consequential line in this
 * application — the one deciding that every endpoint is closed by default — in a
 * file whose name suggests it only concerns `/auth`.
 *
 * **`OAuthService`, `OAuthController` and the `OAUTH_PROVIDERS` factory live
 * here too (Task 12).** This module already owns `SessionService` and the
 * refresh cookie both `OAuthService.complete` and `AuthController.login` share,
 * and `OAuthService`'s own five-dependency constructor (`Repository<UserRecord>`,
 * `IdentitiesService`, `SessionService`, `AuditService`, `DataSource`) is
 * satisfiable entirely from what this module already imports or provides —
 * `OAuthAuthorizationRequestRecord` is the one entity this task adds to the
 * `TypeOrmModule.forFeature` list below.
 *
 * **`IdentitiesController` is registered here too, not by `IdentitiesModule`.**
 * See that controller's own doc and `identities.module.ts`'s: its new
 * `beginLink` route needs `OAuthService`, and importing `AuthModule` back from
 * `IdentitiesModule` to reach it would make the two modules depend on each
 * other — resolvable in Nest only with `forwardRef` on both sides, which this
 * module avoids by hosting the controller where the service it needs already
 * lives, at the cost of a controller registered outside the module its package
 * folder implies.
 */
@Module({
  imports: [
    ConfigModule,
    AuditModule,
    IdentitiesModule,
    MailModule,
    PassportModule,
    TypeOrmModule.forFeature([
      UserRecord,
      AuthIdentityRecord,
      SessionRecord,
      RefreshTokenRecord,
      EmailVerificationTokenRecord,
      PasswordResetTokenRecord,
      OAuthAuthorizationRequestRecord,
    ]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: accessTokenSigningOptions,
    }),
  ],
  controllers: [AuthController, OAuthController, IdentitiesController],
  providers: [
    AuthService,
    SessionService,
    RefreshTokenService,
    JwtStrategy,
    JwtAuthGuard,
    OAuthService,
    OAUTH_PROVIDERS_PROVIDER,
    OAUTH_PROVIDER_REGISTRY_PROVIDER,
  ],
  exports: [AuthService, SessionService, RefreshTokenService, JwtAuthGuard, OAuthService],
})
export class AuthModule {}
