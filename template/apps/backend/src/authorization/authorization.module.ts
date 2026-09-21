import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MembershipRecord } from '../organizations/membership-record.entity';
import { OrganizationRecord } from '../organizations/organization-record.entity';
import { UserRecord } from '../users/user-record.entity';
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
 * than importing it from `AuthModule`. Four entity registrations and nothing
 * else is the whole dependency.
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
 * the guard leaves the route where Tasks 10-12 left it, and where
 * `organizations.controller.spec.ts` can turn red when somebody deletes one.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserRecord,
      MembershipRecord,
      ResourceGrantRecord,
      OrganizationRecord,
    ]),
  ],
  providers: [PrincipalService, PermissionsGuard],
  exports: [PrincipalService, PermissionsGuard],
})
export class AuthorizationModule {}
