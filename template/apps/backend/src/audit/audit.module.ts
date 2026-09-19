import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlatformAdminGuard } from '../auth/guards';
import { UserRecord } from '../users/user-record.entity';
import { AuditEntryRecord } from './audit-entry-record.entity';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

/**
 * Provides {@link AuditService}.
 *
 * Exported as a class rather than behind a symbol, unlike `MAILER` and
 * `PASSWORD_HASHER`: those are ports with a swappable adapter behind them
 * (ADR-0008), whereas there is exactly one way to write to this deployment's
 * own audit table and a second implementation would be a second history.
 *
 * It provides `PlatformAdminGuard` itself rather than importing it from
 * `AuthModule`, which would be a cycle: `AuthModule` imports this module, so
 * this module cannot import that one. See `UsersModule` for the same note.
 */
@Module({
  imports: [TypeOrmModule.forFeature([AuditEntryRecord, UserRecord])],
  controllers: [AuditController],
  providers: [AuditService, PlatformAdminGuard],
  exports: [AuditService],
})
export class AuditModule {}
