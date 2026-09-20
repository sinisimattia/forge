import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { MembershipRecord } from './membership-record.entity';
import { OrganizationRecord } from './organization-record.entity';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';

/**
 * Organizations and their members.
 *
 * `MembershipRecord` is registered here rather than in a separate module of
 * its own: Task 11 adds members to this same `OrganizationsService`, not to a
 * new service, and `TypeOrmModule.forFeature` has to name every entity a
 * module's repositories inject regardless of which method reaches for it
 * first. `InvitationRecord` and `ResourceGrantRecord` join this list in Tasks
 * 12 and 13 for the same reason.
 */
@Module({
  imports: [TypeOrmModule.forFeature([OrganizationRecord, MembershipRecord]), AuditModule],
  controllers: [OrganizationsController],
  providers: [OrganizationsService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
