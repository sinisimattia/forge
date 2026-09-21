import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { AuthorizationModule } from '../authorization';
import { MailModule } from '../mail';
import { UserRecord } from '../users/user-record.entity';
import { InvitationRecord } from './invitation-record.entity';
import { InvitationsController } from './invitations.controller';
import { MembersController } from './members.controller';
import { MembershipRecord } from './membership-record.entity';
import { OrganizationRecord } from './organization-record.entity';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';

/**
 * Organizations, their members, and the invitations that create them.
 *
 * `MembershipRecord` and `InvitationRecord` are registered here rather than
 * in a module of their own: Tasks 11 and 12 add members and invitations to
 * this same `OrganizationsService`, not to a new service, and
 * `TypeOrmModule.forFeature` has to name every entity a module's repositories
 * inject regardless of which method reaches for it first. `UserRecord` joins
 * the list because `inviteMember` and `acceptInvitation` both have to read a
 * user by id or by address — the same reason `AuditModule` and `UsersModule`
 * each register `UserRecord` themselves rather than importing one another's
 * module, which would be a cycle. `ResourceGrantRecord` joins this list in
 * Task 13 for the same reason.
 *
 * `MailModule` and `ConfigModule` are imported for the same reason
 * `AuthModule` imports them: `inviteMember` sends a message built from
 * `PUBLIC_WEBAPP_URL`, and a module that only worked because some other module
 * happened to register its dependencies globally could not be unit-tested or
 * reused on its own.
 *
 * `MembersController` and `InvitationsController` are further controllers on
 * the same service, for the reason `MembersController`'s own comment gives —
 * distinct resources under their own paths, not a second or third service.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([OrganizationRecord, MembershipRecord, InvitationRecord, UserRecord]),
    AuditModule,
    MailModule,
    ConfigModule,
    // Without it, `@UseGuards(PermissionsGuard)` on the controllers below
    // resolves nothing and this module fails to start — a guard named in
    // `@UseGuards` is instantiated from the module context of the controller
    // that names it.
    AuthorizationModule,
  ],
  controllers: [OrganizationsController, MembersController, InvitationsController],
  providers: [OrganizationsService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
