import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserRecord } from '../users/user-record.entity';
import { AuditEntryRecord } from './audit-entry-record.entity';
import { AuditService } from './audit.service';

/**
 * Provides {@link AuditService}.
 *
 * Exported as a class rather than behind a symbol, unlike `MAILER` and
 * `PASSWORD_HASHER`: those are ports with a swappable adapter behind them
 * (ADR-0008), whereas there is exactly one way to write to this deployment's
 * own audit table and a second implementation would be a second history.
 */
@Module({
  imports: [TypeOrmModule.forFeature([AuditEntryRecord, UserRecord])],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
