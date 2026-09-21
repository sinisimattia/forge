import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditEntryRecord } from '../audit/audit-entry-record.entity';
import { AuditService } from '../audit/audit.service';
import { MembershipRecord } from '../organizations/membership-record.entity';
import { OrganizationRecord } from '../organizations/organization-record.entity';
import { UserRecord } from '../users/user-record.entity';
import { AuthorizationService } from './authorization.service';
import { GrantsController } from './grants.controller';
import { PermissionsGuard } from './permissions.guard';
import { PrincipalService } from './principal.service';
import { ResourceGrantRecord } from './resource-grant-record.entity';

/**
 * The hydrator and the guard: everything needed to turn `@RequirePermission`
 * into an answer.
 *
 * It imports no other module of this application, on purpose. Authorization is
 * consulted by `OrganizationsModule` and `UsersModule`, and both of those
 * already sit downstream of `AuditModule` and `AuthModule` — a module here that
 * reached back for any of them would close a cycle, which is the same hazard
 * `UsersModule` explains when it provides `PlatformAdminGuard` itself rather
 * than importing it from `AuthModule`. Entity registrations, and its own
 * `AuditService` instance and its own controller, and nothing else, is the
 * whole dependency; see the note below on why.
 *
 * `PermissionsGuard` is exported as well as provided, because a guard named in
 * `@UseGuards` is resolved from the module context of the controller that names
 * it — so every module whose controllers carry the annotation has to be able to
 * see it, and seeing it means importing this.
 *
 * It is deliberately **not** an `APP_GUARD`. Registered globally it would run on
 * every route, and every route that declares no permission would depend on its
 * "no annotation, nothing to decide" branch staying correct forever — turning a
 * default-closed arrangement into one where the whole application's
 * authorization hangs on one `if`. Per-route is the arrangement where forgetting
 * the guard leaves the route exactly as open as it already was, and where
 * `organizations.controller.spec.ts` can turn red when somebody deletes one.
 *
 * ## `GrantsController`, and why `AuditService` is provided here
 * rather than imported
 *
 * `GrantsController` lives here — a distinct resource, mounted the way
 * `MembersController` is, but on this module because it is layer three's own
 * administrative surface. `AuthorizationService` needs `AuditService` to write
 * `GRANT_CREATED`/`GRANT_REVOKED`, and `AuditModule` is deliberately not
 * imported for it: this class's own opening paragraph already says this module
 * imports nothing else, and this controller is what makes that rule bind. `AuditModule`
 * now has to import THIS module too, for `OrganizationAuditController`'s own
 * guard, and importing `AuditModule` back from here would close the exact cycle
 * `UsersModule` describes for `PlatformAdminGuard`. So `AuditService` is
 * provided directly — a second instance over the same tables — for the reason
 * that comment gives: a stateless service costs nothing to construct twice; a
 * module cycle costs a graph nobody can reason about. `AuditEntryRecord` joins
 * the entity list for exactly that instance's sake, which is why there are five
 * registrations below and not four.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserRecord,
      MembershipRecord,
      ResourceGrantRecord,
      OrganizationRecord,
      AuditEntryRecord,
    ]),
  ],
  controllers: [GrantsController],
  providers: [PrincipalService, PermissionsGuard, AuditService, AuthorizationService],
  exports: [PrincipalService, PermissionsGuard],
})
export class AuthorizationModule {}
