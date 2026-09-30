import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { UserRecord } from '../users/user-record.entity';
import { MfaMethodRecord } from './entities/mfa-method-record.entity';
import { MfaController } from './mfa.controller';
import { MfaService } from './mfa.service';
import { WebAuthnCeremonies } from './webauthn/WebAuthnCeremonies';
import { buildWebAuthnConfig, WEBAUTHN_CONFIG } from './webauthn/webauthn.config';

/**
 * Managing one's own second factors: `/mfa/methods`, `/mfa/totp/*`,
 * `DELETE /mfa/:id` and `/mfa/recovery-codes`.
 *
 * `RecoveryCodes`, `TotpVerifier` and `MfaVerificationService` are provided by `AuthModule`, which needs
 * them to complete a sign-in, and exported from it — one instance of each rather
 * than a second, separately configured copy here that could drift from the one
 * that verifies a login.
 */
@Module({
  imports: [
    ConfigModule,
    AuthModule,
    AuditModule,
    TypeOrmModule.forFeature([MfaMethodRecord, UserRecord]),
  ],
  controllers: [MfaController],
  providers: [
    MfaService,
    // The two WebAuthn routes. It takes `WEBAUTHN_CONFIG` below, which is
    // `null` for a deployment without WebAuthn — so the provider is built
    // either way and every route it serves refuses cleanly, rather than the
    // routes existing only sometimes and answering a different status when
    // they do not.
    WebAuthnCeremonies,
    {
      // A factory provider is built while the application boots, whether or not
      // anything injects it, so a half-configured WebAuthn refuses to start the API
      // here rather than failing each user's ceremony later.
      provide: WEBAUTHN_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => buildWebAuthnConfig({
        MFA_WEBAUTHN_ENABLED: config.get<string>('MFA_WEBAUTHN_ENABLED'),
        MFA_WEBAUTHN_RP_ID: config.get<string>('MFA_WEBAUTHN_RP_ID'),
        MFA_WEBAUTHN_ORIGIN: config.get<string>('MFA_WEBAUTHN_ORIGIN'),
        MFA_ISSUER: config.get<string>('MFA_ISSUER'),
      }),
    },
  ],
})
export class MfaModule {}
