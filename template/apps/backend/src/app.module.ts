import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditEntryRecord } from './audit/audit-entry-record.entity';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards';
import { EmailVerificationTokenRecord } from './auth/entities/email-verification-token-record.entity';
import { RefreshTokenRecord } from './auth/entities/refresh-token-record.entity';
import { SessionRecord } from './auth/entities/session-record.entity';
import { PasswordResetTokenRecord } from './auth/entities/password-reset-token-record.entity';
import { HealthModule } from './health/health.module';
import { AuthIdentityRecord } from './identities/auth-identity-record.entity';
import { MailModule } from './mail';
import { UserRecord } from './users/user-record.entity';

/**
 * The application's own database connection uses `DATABASE_URL`, which in a
 * two-role deployment is the *restricted* role — not the schema owner the
 * migrations run as (`db/data-source.ts`). That is what makes `audit_entries`
 * append-only to this process in a way no code here can undo; see
 * `db/migrations/1758000002000-AuditAppendOnly.ts`.
 *
 * Entities are listed rather than globbed. A glob would have to be right in two
 * different directory layouts — the source tree and the production image — and
 * a glob that matches nothing produces a connection with no entities and no
 * complaint. This list is checked by the compiler.
 *
 * No `migrations` entry. There was one (`['dist/db/migrations/*.js']`) and it
 * was dead: with `rootDir` pinned to the workspace root the backend emits to
 * `dist/apps/backend/src/`, so that path resolved to a directory that never
 * exists — and nothing read it either way, since `synchronize` is false and
 * `migrationsRun` was never set. Migrations are applied by the CLI, through the
 * owner's data source, by the `migrate` service in both compose files.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env'] }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        url: config.getOrThrow<string>('DATABASE_URL'),
        entities: [
          UserRecord,
          AuthIdentityRecord,
          SessionRecord,
          RefreshTokenRecord,
          EmailVerificationTokenRecord,
          PasswordResetTokenRecord,
          AuditEntryRecord,
        ],
        synchronize: false,
      }),
    }),
    HealthModule,
    MailModule,
    AuditModule,
    AuthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }],
})
export class AppModule {}
