import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlatformAdminGuard } from '../auth/guards';
import { AuthorizationModule } from '../authorization';
import { AuditPrivilegeCheck } from '../db/audit-privilege-check';
import { MembershipRecord } from '../organizations/membership-record.entity';
import { OrganizationRecord } from '../organizations/organization-record.entity';
import { UserRecord } from '../users/user-record.entity';
import { AuditEntryRecord } from './audit-entry-record.entity';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { OrganizationAuditController } from './organization-audit.controller';

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
 * lifecycle hook and no consumer, so nothing imports it, so no test reaches it
 * by using it — which is exactly why `../db/__tests__/audit-privilege-check.spec.ts`
 * reads this array off the decorator and asserts the class is in it. (That
 * pointer named `__tests__/composition-root.spec.ts` for one commit, which
 * contains no such assertion; a reader following it found nothing and would have
 * concluded the provider was unguarded.)
 *
 * It provides `PlatformAdminGuard` itself rather than importing it from
 * `AuthModule`, which would be a cycle: `AuthModule` imports this module, so
 * this module cannot import that one. See `UsersModule` for the same note.
 *
 * **`AuthorizationModule` is imported for `PermissionsGuard`**, which
 * `OrganizationAuditController` names — Task 14. This is the direction that
 * does NOT close a cycle: `AuthorizationModule` provides its own `AuditService`
 * instance rather than importing this module back (see that module's own
 * TSDoc), exactly the arrangement `UsersModule` already uses for
 * `PlatformAdminGuard` one level up. `MembershipRecord` joins the entity list
 * for the same reason — `AuditService.queryForOrganization` reads it to
 * establish the actor's real membership of the organization the route names,
 * independently of what `PermissionsGuard` already decided.
 *
 * ## `OrganizationRecord` is registered here, and importing the guard is not enough
 *
 * **The application did not boot without this line**, and the reason is worth
 * stating because it is not what importing `AuthorizationModule` suggests. A
 * guard named in `@UseGuards` is instantiated in the module context of the
 * controller that names it, so `PermissionsGuard`'s own constructor
 * dependencies have to be resolvable *here* — and it injects
 * `Repository<OrganizationRecord>`, which `AuthorizationModule` registers for
 * itself and does not export. Importing the module that exports the guard gets
 * the guard; it does not get what the guard needs.
 *
 * Nest said so plainly, and only at boot:
 * `Nest can't resolve dependencies of the PermissionsGuard (Reflector,
 * PrincipalService, ?) … "OrganizationRecordRepository" at index [2] is
 * available in the AuditModule module`. Nothing in the fast tiers could see it,
 * because every spec here builds its own testing module with an explicit
 * provider list. `__tests__/guard-wiring.spec.ts` is what turns red now.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      AuditEntryRecord, UserRecord, MembershipRecord, OrganizationRecord,
    ]),
    AuthorizationModule,
  ],
  controllers: [AuditController, OrganizationAuditController],
  providers: [AuditService, PlatformAdminGuard, AuditPrivilegeCheck],
  exports: [AuditService],
})
export class AuditModule {}
