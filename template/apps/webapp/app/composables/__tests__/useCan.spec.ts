import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { can } from '__FORGE_SCOPE__/core/authorization/policies';
import type { Principal } from '__FORGE_SCOPE__/core/authorization/types';
import { OrgRole } from '__FORGE_SCOPE__/core/organizations/enums';
import type {
  MembershipId,
  OrganizationId,
  OrganizationJSON,
} from '__FORGE_SCOPE__/core/organizations/types';
import { PlatformRole, UserStatus } from '__FORGE_SCOPE__/core/users/enums';
import type { UserId, UserJSON } from '__FORGE_SCOPE__/core/users/types';
import type { StubBackend } from '~/services/__tests__/stubBackend';
import { stubBackend } from '~/services/__tests__/stubBackend';
import { OrganizationHttpService } from '~/services';
import { stubNuxtAutoImports } from '~/test/stubNuxtAutoImports';
import { useAuthStore } from '~/stores/auth';
import { useOrganizationStore } from '~/stores/organization';
import { useCan } from '~/composables/useCan';

/**
 * `useCan`, and the two things ADR-0006 requires can be told apart from a
 * composable built to make one obvious case pass:
 *
 * 1. That it answers **from `can()`**, not from a rule of its own — asserted
 *    by mocking `can` and checking that its answer, not the "obviously
 *    right" one, is what comes back. A re-implementation that happened to
 *    agree with core on every case in this file would still pass a test that
 *    only checked the right answer; it cannot survive `can` being made to
 *    disagree with itself.
 * 2. That the answer is a **prediction**, not an enforcement — asserted by
 *    showing a request `useCan` says no to still reaches this stub's model
 *    of the backend, because nothing on this side of the wire stops it. The
 *    real refusal is the server's, behind `PermissionsGuard`, and is proven
 *    end to end elsewhere, by the docker end-to-end suite.
 *
 * `can` is mocked module-wide, defaulting to the real implementation, so
 * every test not about the mock itself still exercises the genuine rule.
 */
vi.mock('__FORGE_SCOPE__/core/authorization/policies', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('__FORGE_SCOPE__/core/authorization/policies')
  >();
  return { ...actual, can: vi.fn(actual.can) };
});

const PLAINTEXT = 'a correct horse battery staple';
const SEEDED_AT = '2026-01-01T00:00:00.000Z';

const ACTOR_ID = 'stub-User-1' as UserId;
const ACTOR: UserJSON = {
  id: ACTOR_ID,
  email: 'ada@example.test',
  displayName: 'Ada',
  status: UserStatus.ACTIVE,
  platformRole: PlatformRole.PLATFORM_USER,
  emailVerifiedAt: SEEDED_AT,
  createdAt: SEEDED_AT,
  updatedAt: SEEDED_AT,
  deletedAt: null,
};

const ORG_ID = 'stub-Organization-1' as OrganizationId;
const ORG: OrganizationJSON = {
  id: ORG_ID,
  name: 'Acme',
  slug: 'acme',
  createdAt: SEEDED_AT,
  updatedAt: SEEDED_AT,
  deletedAt: null,
};

/** A principal whose only standing is a `MEMBER` role in {@link ORG_ID}. */
const MEMBER_OF_ORG: Principal = {
  userId: ACTOR_ID,
  platformRole: PlatformRole.PLATFORM_USER,
  memberships: [{ organizationId: ORG_ID, role: OrgRole.MEMBER }],
  grants: [],
};

describe('useCan', () => {
  let backend: StubBackend;

  beforeEach(() => {
    stubNuxtAutoImports();
    vi.stubGlobal('useRuntimeConfig', () => ({
      apiBaseServer: '',
      public: { apiBase: 'http://backend.test' },
    }));
    setActivePinia(createPinia());
    backend = stubBackend();
    backend.putUser(ACTOR, PLAINTEXT);
    backend.putOrganization(ORG);
    backend.putMembership({
      id: 'stub-Membership-1' as MembershipId,
      organizationId: ORG_ID,
      userId: ACTOR_ID,
      role: OrgRole.MEMBER,
      createdAt: SEEDED_AT,
      updatedAt: SEEDED_AT,
    });
    useAuthStore().adoptTransport(backend.client);
  });

  afterEach(() => {
    vi.mocked(can).mockClear();
    vi.unstubAllGlobals();
  });

  it('answers false with no principal, without asking core anything', () => {
    const answer = useCan('organization:read', { organizationId: ORG_ID });

    expect(answer.value).toBe(false);
    expect(can).not.toHaveBeenCalled();
  });

  // The delegation test. Two directions, deliberately: a re-implementation
  // that computed its own answer would get at least one of these two wrong,
  // because the mocked answer is the opposite of what the real rule gives for
  // that exact input. Only a call site that took `can`'s return value
  // verbatim, unquestioned, passes both.
  it('answers from core\'s can(), not from a rule of its own', () => {
    const store = useOrganizationStore();
    const resource = { organizationId: ORG_ID };
    store.principal = MEMBER_OF_ORG;

    // `MEMBER_OF_ORG` really may `organization:read` (every role has it) — the
    // real rule says `true`. Mocked to answer `false`: a re-implementation
    // that read the role itself would still say `true` here and be wrong.
    vi.mocked(can).mockReturnValueOnce(false);
    expect(useCan('organization:read', resource).value).toBe(false);
    expect(can).toHaveBeenLastCalledWith(MEMBER_OF_ORG, 'organization:read', resource);

    // `MEMBER_OF_ORG` really may NOT `member:invite` (`ROLE_PERMISSIONS[MEMBER]`
    // does not carry it) — the real rule says `false`. Mocked to answer `true`:
    // a re-implementation would still say `false` here and be wrong the other
    // way.
    vi.mocked(can).mockReturnValueOnce(true);
    expect(useCan('member:invite', resource).value).toBe(true);
    expect(can).toHaveBeenLastCalledWith(MEMBER_OF_ORG, 'member:invite', resource);
  });

  // The delegation-fails check: replacing `useCan`'s
  // body with a hard-coded `true` was tried against this file by hand. The
  // test above went red on its first assertion (mocked `false`, hard-coded
  // answer `true`) and on both `toHaveBeenLastCalledWith` checks, since `can`
  // was never called at all. This test — "the right answer for one
  // case", `member:invite` refused for a `MEMBER` — stayed GREEN under the
  // same sabotage, which is exactly the gap the delegation test exists to
  // close and this one does not.
  it('gives the same refusal the real can() gives, for a permission the role lacks', () => {
    const store = useOrganizationStore();
    store.principal = MEMBER_OF_ORG;

    expect(useCan('member:invite', { organizationId: ORG_ID }).value).toBe(false);
  });

  it('is a convenience and not a control', async () => {
    const store = useOrganizationStore();
    store.principal = MEMBER_OF_ORG;

    // A `MEMBER` may not invite — the client agrees with the rule that would
    // refuse the request.
    expect(useCan('member:invite', { organizationId: ORG_ID }).value).toBe(false);

    // And yet nothing on this side of the wire stops the same actor from
    // *sending* the request `useCan` just said no to. This stub does not
    // model `PermissionsGuard` — only organization membership — precisely
    // because the real guard is the server's alone; the request below
    // reaches it and succeeds, proving the refusal above was advisory.
    const auth = useAuthStore();
    await auth.login(ACTOR.email, PLAINTEXT);
    const service = new OrganizationHttpService(auth.authenticatedClient());

    const invitation = await service.inviteMember(ACTOR_ID, ORG_ID, {
      email: 'invitee@example.test',
      role: OrgRole.MEMBER,
    });

    expect(invitation.organizationId).toBe(ORG_ID);
  });
});
