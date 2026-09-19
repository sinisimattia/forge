import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, JwtModuleOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DEFAULT_PASSWORD_POLICY } from '__FORGE_SCOPE__/core/identities/policies';
import { AuditModule } from '../audit/audit.module';
import {
  BREACHED_PASSWORD_REGISTRY,
  NoOpBreachedPasswordRegistry,
} from '../identities/breached-passwords';
import { AuthIdentityRecord } from '../identities/auth-identity-record.entity';
import { Argon2PasswordHasher, PASSWORD_HASHER } from '../identities/hashing';
import { IdentitiesService } from '../identities/identities.service';
import { MailModule } from '../mail';
import { UserRecord } from '../users/user-record.entity';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { EmailVerificationTokenRecord } from './entities/email-verification-token-record.entity';
import { PasswordResetTokenRecord } from './entities/password-reset-token-record.entity';
import { RefreshTokenRecord } from './entities/refresh-token-record.entity';
import { SessionRecord } from './entities/session-record.entity';
import { JwtAuthGuard } from './guards';
import { RefreshTokenService } from './session/refresh-token.service';
import { ACCESS_TOKEN_TTL_SECONDS, SessionService } from './session/session.service';
import { JwtStrategy } from './strategies';

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
 * Two ports are bound here rather than in modules of their own, and both are
 * ADR-0008 ports whose only consumer today is this module: the password hasher
 * and the breached-password registry. `MAILER` is not — it has its own module,
 * because a mailer's second consumer (anything that notifies anybody) arrives
 * with the first feature somebody adds.
 *
 * `JwtAuthGuard` is provided here as an ordinary class and registered as the
 * application-wide guard in `app.module.ts`. It is deliberately **not**
 * registered as `APP_GUARD` from this module: a module-level `APP_GUARD` still
 * applies globally, which would put the single most consequential line in this
 * application — the one deciding that every endpoint is closed by default — in a
 * file whose name suggests it only concerns `/auth`.
 */
@Module({
  imports: [
    ConfigModule,
    AuditModule,
    MailModule,
    PassportModule,
    TypeOrmModule.forFeature([
      UserRecord,
      AuthIdentityRecord,
      SessionRecord,
      RefreshTokenRecord,
      EmailVerificationTokenRecord,
      PasswordResetTokenRecord,
    ]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: accessTokenSigningOptions,
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    IdentitiesService,
    SessionService,
    RefreshTokenService,
    JwtStrategy,
    JwtAuthGuard,
    {
      // An explicit factory rather than `useClass`, because the adapter's one
      // constructor parameter is a `PasswordPolicy` — an interface, with no
      // runtime token for Nest to resolve. This is also the line a deployment
      // changes to apply its own policy. See `Argon2PasswordHasher`'s own
      // comment for why the class carries no `@Injectable()`.
      provide: PASSWORD_HASHER,
      useFactory: () => new Argon2PasswordHasher(DEFAULT_PASSWORD_POLICY),
    },
    {
      // ADR-0008: the seam exists and answers `false`. Binding a real corpus is
      // changing this one line — see `NoOpBreachedPasswordRegistry` for what
      // such an implementation owes, and the trap it is walking into.
      provide: BREACHED_PASSWORD_REGISTRY,
      useClass: NoOpBreachedPasswordRegistry,
    },
  ],
  exports: [AuthService, SessionService, RefreshTokenService, JwtAuthGuard],
})
export class AuthModule {}
