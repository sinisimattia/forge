/**
 * The webapp's implementations of `libs/core`'s contracts.
 *
 * Each of these is an `I*Service` in full, implemented over the wire, and each is
 * held to the **same** conformance suite the backend's implementation is held to
 * — jest there, vitest here, one suite in core. That is what turns "both apps
 * implement the same contracts" from a claim in a design document into a fact the
 * build checks (DEC-1).
 *
 * They are the second link of `STANDARDS.md` W2: fetcher → service → composable →
 * component. A composable holds the reactive state; a service holds the mapping;
 * a fetcher holds the path. A component calls none of them but the composable.
 */
export { AuthHttpService } from './auth.service';
export { AuthorizationHttpService } from './authorization.service';
export { IdentityHttpService } from './identity.service';
export { OrganizationHttpService } from './organization.service';
export { UserHttpService } from './user.service';
