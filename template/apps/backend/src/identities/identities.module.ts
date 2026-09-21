import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DEFAULT_PASSWORD_POLICY } from '__FORGE_SCOPE__/core/identities/policies';
import { AuditModule } from '../audit/audit.module';
import { AuthIdentityRecord } from './auth-identity-record.entity';
import { BREACHED_PASSWORD_REGISTRY, NoOpBreachedPasswordRegistry } from './breached-passwords';
import { Argon2PasswordHasher, PASSWORD_HASHER } from './hashing';
import { IdentitiesService } from './identities.service';

/**
 * Everything that happens to an `auth_identities` row, and the two ports behind
 * it.
 *
 * Both ports moved here from `AuthModule`, which bound them because it was the
 * only consumer at the time. It is no longer: this module owns the rows the
 * hasher writes into, and `AuthModule` now imports this one. Binding them in two
 * modules instead would give the application two hashers and two registries —
 * harmless today, because both are stateless, and exactly the kind of accident
 * that stops being harmless the moment one of them holds a connection or a
 * cache.
 *
 * **`IdentitiesController` is not registered here.** It still lives in this
 * package (`identities.controller.ts`), but it carries a route —
 * `beginLink` — that needs `OAuthService`, which lives in `AuthModule`.
 * `AuthModule` already imports this module for `AuthService`'s own need of
 * `IdentitiesService`; importing `AuthModule` back from here to reach
 * `OAuthService` would make the two modules depend on each other, resolvable
 * in Nest only with `forwardRef` on both sides. `AuthModule` registers the
 * controller instead — see its own module doc and
 * `identities/identities.controller.ts`'s own doc for the full reasoning.
 * This module still provides and exports `IdentitiesService`, which is all
 * that controller (and `AuthService`, and `OAuthService`) actually need from
 * it.
 */
@Module({
  imports: [TypeOrmModule.forFeature([AuthIdentityRecord]), AuditModule],
  providers: [
    IdentitiesService,
    {
      // An explicit factory rather than `useClass`, because the adapter's one
      // constructor parameter is a `PasswordPolicy` — an interface, with no
      // runtime token for the framework to resolve. This is also the line a
      // deployment changes to apply its own policy. See `Argon2PasswordHasher`'s
      // own comment for why the class carries no `@Injectable()`.
      provide: PASSWORD_HASHER,
      useFactory: () => new Argon2PasswordHasher(DEFAULT_PASSWORD_POLICY),
    },
    {
      // ADR-0008: the seam exists and answers `false`. Binding a real corpus is
      // changing this one line — see `NoOpBreachedPasswordRegistry` for what
      // such an implementation owes, and the trap it is walking into.
      //
      // "This one line" is now true of the whole surface, and it was not always.
      // The port was consulted on registration alone, so binding a corpus bought
      // a check on the one path where somebody is *choosing* a password and none
      // on the two where they are *replacing* one — including recovery, which is
      // what somebody does when they believe their credential is already in
      // somebody else's hands. `AuthService.refuseIfPublic` is the one caller
      // now, and registration, recovery and a deliberate change all go through
      // it. Anything added later that sets a password calls it too, or the claim
      // on this line stops being true again.
      provide: BREACHED_PASSWORD_REGISTRY,
      useClass: NoOpBreachedPasswordRegistry,
    },
  ],
  exports: [IdentitiesService, PASSWORD_HASHER, BREACHED_PASSWORD_REGISTRY],
})
export class IdentitiesModule {}
