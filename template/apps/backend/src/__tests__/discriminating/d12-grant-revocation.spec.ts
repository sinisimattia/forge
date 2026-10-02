import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import type { GrantId } from '__FORGE_SCOPE__/core/authorization/types';
import { OrgRole } from '__FORGE_SCOPE__/core/organizations/enums';
import {
  buildWorld,
  ADMIN_A, GRANT_B, MEMBER_B, ORG_A, ORG_B, OWNER_A, OWNER_B,
  type DiscriminatingWorld,
} from './world';

/**
 * D12 — "a `ResourceGrant` revoked mid-session → next request denied, no stale
 * cache".
 *
 * # THIS FILE IS A LABELLED PARTIAL. D12 IS NOT SATISFIED, AND NOTHING BELOW
 * # SHOULD BE READ AS SATISFYING IT.
 *
 * It is written down rather than left out so that the gap is visible, dated and
 * pinned, instead of being an absence somebody later reads as an oversight — or,
 * worse, an absence somebody helpfully fills with a green test that exercises
 * nothing.
 *
 * ## Why D12 is not testable against any route this backend mounts
 *
 * D12's "denied" has to be denied *by something*. The only thing that could deny
 * on the strength of a grant is `can()`'s layer three, and **no `can()` call site
 * in this backend passes `resourceType`/`resourceId`**, so layer three is
 * evaluated on no request this application serves.
 *
 * That is deliberate and it is not a shortcut. `PermissionsGuard` sets out the
 * reasoning at length: a grant is an exception about one *record inside* a
 * tenant, and naming the organization itself as the record would make
 * `grant:create` — which an organization ADMIN holds — a route to
 * `organization:delete`, the one action `Permission`'s own documentation says no
 * administrator can be delegated. An ADMIN could issue themselves the grant and
 * then use it. So grants are stored, administered, hydrated and expiry-filtered,
 * and **consumed by no decision**.
 *
 * ## The two options, and which was taken
 *
 * The honest choices were (a) extend this partial and keep it labelled, or (b)
 * add a fixture resource route whose `@RequirePermission` is asked *with* a
 * `resourceType`/`resourceId`, which would make layer three reachable and D12
 * genuinely testable.
 *
 * **(a) was taken.** (b) is not a test change: `PermissionsGuard` has no way to
 * be told a route's record type and id, so (b) means designing that mechanism —
 * where the id comes from, whether it is a second path parameter or a per-route
 * annotation, and what happens when a route names a record that turns out to
 * belong to another tenant. That is a production authorization feature, and
 * inventing one inside a testing task to make a row of a table go green is
 * precisely the move this suite is organised against. It belongs to whoever
 * first ships a record-scoped resource, and the assertion at the bottom of this
 * file is what will tell them that D12 is now owed.
 *
 * ## What this file does establish
 *
 * The no-caching half: the principal is rebuilt from rows on every single
 * request, so a withdrawal takes effect on the next one. That is the property
 * that would be wrong the day `PrincipalService` grew a cache, and it *is*
 * observable over the wire — through an organization ROLE, which layer two does
 * consume. The grant assertions stop at `PrincipalService`, because the wire has
 * nothing to show.
 */
describe('D12 (PARTIAL — layer three is consumed by nothing; see this file’s preamble)', () => {
  let world: DiscriminatingWorld;

  beforeEach(async () => {
    world = await buildWorld();
  });

  afterEach(async () => {
    await world.close();
  });

  /**
   * The wire-observable half, and the one assertion in this directory that
   * catches a stale principal through a route's own answer.
   *
   * ## Why a demotion and not a removal
   *
   * The obvious probe — remove somebody's membership mid-session and watch the
   * next request be refused — **does not detect a cached principal**, and it was
   * tried first. `OrganizationsService.requireMember` re-reads the membership
   * row on its own, so a route whose guard was fooled by a stale cache is caught
   * one layer down by the service, and the caller still gets a 404. That is
   * defence in depth working exactly as intended, and it makes membership
   * removal useless as evidence about the hydrator.
   *
   * A **role** demotion has no such second check. `requireMember` asks whether
   * the actor is a member, never what role they hold; `can()` is the only thing
   * that reads the role, and `PermissionsGuard` is the only thing that calls it
   * for this route. So `organization:update` after a demotion from ADMIN to
   * MEMBER is a decision the hydrated principal alone carries — which is
   * precisely the position a `ResourceGrant` would be in if layer three were
   * ever consumed, and the reason this assertion stands in for the one D12 asks
   * for.
   */
  describe('authority withdrawn mid-session, over the wire', () => {
    it('is honoured on the request before and refused on the very next one', async () => {
      // Same credential throughout: D12 is about a *session*, and
      // re-authenticating between the two requests would test something nobody
      // experiences.
      const credential = world.bearer(ADMIN_A);

      await request(world.app.getHttpServer())
        .patch(`/organizations/${ORG_A}`)
        .set('Authorization', credential)
        .send({ name: 'Renamed While Still An Admin' })
        .expect(200);

      await request(world.app.getHttpServer())
        .patch(`/organizations/${ORG_A}/members/${ADMIN_A}`)
        .set('Authorization', world.bearer(OWNER_A))
        .send({ role: OrgRole.MEMBER })
        .expect(200);

      await request(world.app.getHttpServer())
        .patch(`/organizations/${ORG_A}`)
        .set('Authorization', credential)
        .send({ name: 'Renamed After The Demotion' })
        .expect(404);
    });

    // The control: without it the assertion above passes for a guard that
    // refuses `PATCH /organizations/:id` to everybody, which is the same shape
    // of vacuous green D9's permitted column exists to rule out.
    it('leaves an undemoted administrator able to make the same request twice', async () => {
      const credential = world.bearer(ADMIN_A);

      await request(world.app.getHttpServer())
        .patch(`/organizations/${ORG_A}`)
        .set('Authorization', credential)
        .send({ name: 'First Rename' })
        .expect(200);

      await request(world.app.getHttpServer())
        .patch(`/organizations/${ORG_A}`)
        .set('Authorization', credential)
        .send({ name: 'Second Rename' })
        .expect(200);
    });
  });

  /**
   * The grant half, which stops one level short of the wire for the reason the
   * preamble gives. `tenant-isolation.spec.ts` asserts the same shape against
   * `AuthorizationService`; this one drives the revocation over HTTP, so what is
   * asserted is that the *application's own* revocation route is enough — no
   * second step, no cache to invalidate, nothing a caller has to remember.
   */
  describe('a grant revoked mid-session, at the hydrator', () => {
    it('is gone from the very next principal, with no cache keeping it alive', async () => {
      const now = new Date();

      const before = await world.principals.hydrate(MEMBER_B, now);
      expect(before.grants.map((grant) => grant.id)).toContain(GRANT_B as GrantId);

      await request(world.app.getHttpServer())
        .delete(`/organizations/${ORG_B}/grants/${GRANT_B}`)
        .set('Authorization', world.bearer(OWNER_B))
        .expect(204);

      const after = await world.principals.hydrate(MEMBER_B, now);
      expect(after.grants.map((grant) => grant.id)).not.toContain(GRANT_B as GrantId);
    });

    // The same instant is passed to both hydrates above, so that assertion is
    // about the revocation and not about a clock moving. This one is the
    // control: hydrating twice with nothing revoked in between must NOT lose a
    // grant, or the assertion above would pass for a hydrator that returns
    // nothing at all.
    it('keeps a grant that nobody revoked', async () => {
      const now = new Date();

      const first = await world.principals.hydrate(MEMBER_B, now);
      const second = await world.principals.hydrate(MEMBER_B, now);

      expect(first.grants.map((grant) => grant.id)).toContain(GRANT_B as GrantId);
      expect(second.grants.map((grant) => grant.id)).toContain(GRANT_B as GrantId);
    });
  });

  /**
   * THE TRIPWIRE. This is the assertion that keeps the partial above from
   * quietly becoming a lie.
   *
   * The claim this whole file rests on is "layer three is consumed by nothing".
   * That is a claim about the production source, and the day somebody adds a
   * `can()` call that names a record, it stops being true — at which point D12
   * is testable, is owed, and is not written. Nothing else in this repository
   * would notice: the new call site would be covered by its own happy-path
   * spec, and this file would go on describing a world that no longer exists.
   *
   * So it is asserted. When this goes red, the fix is not to update the
   * expectation — it is to write the real D12 against the route that made it
   * reachable, and then delete this partial.
   *
   * **Two debts come due together, not one.** The same claim is what keeps the
   * refusal of `platform:administer` in `can()`'s layer three
   * (`libs/core/src/authorization/policies/can.ts`) inert. That refusal is a
   * case-sensitive comparison of the *requested* permission against a literal.
   * A permission argument that reached `can()` mis-cased — which the
   * `Permission` union blocks at compile time today — would skip the
   * exclusion, and a grant row spelled the same way would then match it. While
   * no decision consults a grant, that cannot matter; the day one does, it can.
   * So when this goes red the comparison is owed attention as well as the real
   * D12: check what the exclusion does with a mis-cased argument, and test it.
   * The casing assertion below pins the argument literals, and exists so that
   * the two facts stay tied.
   */
  describe('the claim this partial rests on', () => {
    const backendSrc = path.resolve(__dirname, '../..');

    const sourceFiles = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true })
      .flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(full);
        return entry.isFile() && full.endsWith('.ts') && !full.endsWith('.spec.ts') ? [full] : [];
      });

    const code = (file: string): string => fs.readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    /**
     * The argument list of every `can(...)` call in `text`, one string each.
     *
     * Paren-balanced rather than regex-matched to the first `)`, because every
     * one of these calls passes an object literal and half of them span lines.
     * A match that stopped at the first `)` would read `can(principal,
     * 'audit:read', { organizationId }` — and would then "prove" no call names a
     * record by having stopped reading before it could.
     */
    const canCalls = (text: string): string[] => {
      const calls: string[] = [];
      const opener = /(^|[^\w.])can\s*\(/g;
      let match = opener.exec(text);

      while (match !== null) {
        let depth = 1;
        let index = match.index + match[0].length;
        while (index < text.length && depth > 0) {
          if (text[index] === '(') depth += 1;
          if (text[index] === ')') depth -= 1;
          index += 1;
        }
        calls.push(text.slice(match.index + match[0].length, index - 1));
        match = opener.exec(text);
      }

      return calls;
    };

    /** Files that call `can(` outside a comment, as paths relative to `src/`. */
    const callSites = (): string[] => sourceFiles(backendSrc)
      .filter((file) => canCalls(code(file)).length > 0)
      .map((file) => path.relative(backendSrc, file))
      .sort();

    it('has exactly the production call sites this partial was written against', () => {
      // Not a style rule — an inventory. A call site appearing that is not on
      // this list has not been read by whoever wrote the paragraph above, and the
      // paragraph is the only thing saying D12 is not owed.
      expect(callSites()).toEqual([
        'audit/audit.service.ts',
        'auth/guards/platform-admin.guard.ts',
        'authorization/permissions.guard.ts',
        'users/users.service.ts',
      ]);
    });

    it('passes no resourceType/resourceId anywhere, so can()’s third layer runs on no request', () => {
      const naming = callSites().flatMap((relative) => {
        const calls = canCalls(code(path.join(backendSrc, relative)));
        expect(calls.length).toBeGreaterThan(0);
        return calls
          .filter((call) => /resourceType|resourceId/.test(call))
          .map((call) => `${relative}: can(${call.replace(/\s+/g, ' ').trim()})`);
      });

      expect(naming).toEqual([]);
    });

    it('spells every permission literal it can see in lower case, so can()’s case-sensitive comparison has nothing to miss', () => {
      // The comparison in `can()` that refuses `platform:administer` at layer
      // three is exact-match. It is inert only while that layer has no consumer,
      // which the two assertions above pin; this one pins the other half, that
      // nothing in the backend source spells the permission any other way and
      // so relies on a comparison that would not match it. Quoted literals only:
      // a permission is only ever written as one. Its limit: it reads the
      // backend source (not `libs/core`) and pins literal spellings, not what a
      // stored row can contain.
      const literal = /(['"`])([^'"`\n]*)\1/g;
      const misspelt = sourceFiles(backendSrc).flatMap((file) => {
        const text = code(file);
        const found: string[] = [];
        for (const match of text.matchAll(literal)) {
          if (/^platform:administer$/i.test(match[2]) && match[2] !== 'platform:administer') {
            found.push(`${path.relative(backendSrc, file)}: ${match[0]}`);
          }
        }
        for (const call of canCalls(text)) {
          for (const match of call.matchAll(literal)) {
            if (/^[a-z]+:[a-z]+$/i.test(match[2]) && match[2] !== match[2].toLowerCase()) {
              found.push(`${path.relative(backendSrc, file)}: can(… ${match[0]} …)`);
            }
          }
        }
        return found;
      });

      expect(misspelt).toEqual([]);
    });
  });
});
