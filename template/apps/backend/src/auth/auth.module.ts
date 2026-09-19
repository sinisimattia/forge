import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, JwtModuleOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { AuthIdentityRecord } from '../identities/auth-identity-record.entity';
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
    ]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: accessTokenSigningOptions,
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, SessionService, RefreshTokenService, JwtStrategy, JwtAuthGuard],
  exports: [AuthService, SessionService, RefreshTokenService, JwtAuthGuard],
})
export class AuthModule {}
