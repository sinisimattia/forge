import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlatformAdminGuard } from '../auth/guards';
import { AuditPrivilegeCheck } from '../db/audit-privilege-check';
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
 * {@link AuditPrivilegeCheck} is provided here rather than in `AppModule` because it
 * is a statement about this module's own table: the application refuses to serve
 * over a connection that can rewrite `audit_entries`. It is a provider with a
 * lifecycle hook and no consumer, so nothing imports it — which is exactly why
 * `__tests__/composition-root.spec.ts` asserts it is in this list.
 *
 * It provides `PlatformAdminGuard` itself rather than importing it from
 * `AuthModule`, which would be a cycle: `AuthModule` imports this module, so
 * this module cannot import that one. See `UsersModule` for the same note.
 */
@Module({
  imports: [TypeOrmModule.forFeature([AuditEntryRecord, UserRecord])],
  controllers: [AuditController],
  providers: [AuditService, PlatformAdminGuard, AuditPrivilegeCheck],
  exports: [AuditService],
})
export class AuditModule {}
