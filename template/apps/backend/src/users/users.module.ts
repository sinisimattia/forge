import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { PlatformAdminGuard } from '../auth/guards';
import { UserRecord } from './user-record.entity';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/**
 * Reading and administering people.
 *
 * It imports `AuthModule` for `SessionService` — closing an account and
 * suspending one both have to end every session the account holds, and the
 * sessions belong to the module that issues them. The dependency goes this way
 * and never the other: `AuthModule` knows nothing about this one, so a
 * registration does not depend on the administration surface existing.
 *
 * `PlatformAdminGuard` is provided **here** rather than exported from
 * `AuthModule`, and the reason is a cycle that would otherwise be unavoidable:
 * the guard needs `AuditService`, `AuthModule` already imports `AuditModule`,
 * and `AuditModule` needs the same guard for its own controller. A guard is a
 * stateless class, so one instance per consuming module costs nothing; a cycle
 * costs a module graph nobody can reason about.
 */
@Module({
  imports: [TypeOrmModule.forFeature([UserRecord]), AuditModule, AuthModule],
  controllers: [UsersController],
  providers: [UsersService, PlatformAdminGuard],
  exports: [UsersService],
})
export class UsersModule {}
