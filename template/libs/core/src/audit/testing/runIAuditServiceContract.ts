import type { UserId } from '../../users/types/UserId';
import type { IAuditService } from '../contracts/IAuditService';
import { AuditEntry } from '../entities/AuditEntry';
import type { AuditAction } from '../enums/AuditAction';
import type { AuditEntryJSON } from '../types/AuditEntryJSON';
import type { AuditQuery } from '../types/AuditQuery';
import type { RecordAuditEntryInput } from '../types/RecordAuditEntryInput';
import type { IAuditServiceContractDeps } from './IAuditServiceContractDeps';

/**
 * One page large enough to hold the whole of any world this suite builds,
 * narrowed by whatever the test is about.
 *
 * A page big enough for everything is what lets a test assert against the entire
 * history rather than against a page of it, so that an entry the implementation
 * lost is missing rather than merely off the end.
 *
 * @param filters - the narrowing this particular test is about
 * @returns the query to hand the service
 */
function wholeHistory(filters: Partial<AuditQuery> = {}): AuditQuery {
  return { page: 1, limit: 100, ...filters };
}

/** Names a member of an implementation is not allowed to have. See the shape guarantee below. */
const MUTATING = /update|delete|remove|purge|truncate/i;

/**
 * One recording, assembled from shorthand.
 *
 * The defaults are the emptiest entry that can be recorded — no tenant, no
 * resource, nothing known about the client, nothing extra to say — so that each
 * test below changes exactly the fields it is about and a reader can see which
 * those are.
 *
 * @param action - what happened
 * @param actorId - who did it, or `null` when nobody was identified
 * @param overrides - the fields this particular test is about
 * @returns the input to hand the service
 */
function recording(
  action: AuditAction,
  actorId: UserId | null,
  overrides: Partial<RecordAuditEntryInput> = {},
): RecordAuditEntryInput {
  return {
    organizationId: null,
    actorId,
    action,
    resourceType: null,
    resourceId: null,
    metadata: {},
    clientAddress: null,
    clientLabel: null,
    occurredAt: new Date(),
    ...overrides,
  };
}

/**
 * A comparable rendering of one entry's extra detail.
 *
 * Its keys are sorted into the rendering rather than compared where they lie,
 * because two stores may hand back the same members in a different order and
 * that is not a difference anybody should have to care about. Flat data only:
 * the sorted key list is what `JSON.stringify` filters by, and it filters at
 * every depth, so a member nested inside another object would be dropped from
 * the comparison rather than compared. Nothing this suite records is nested.
 *
 * Two blind spots, both accepted. `JSON.stringify` drops a member whose value
 * is `undefined`, so an implementation that turned a recorded `undefined` into
 * an absence compares equal here — the case that matters, a member recorded
 * with `null`, is pinned on its own above and by name, which is where the
 * effort belongs. And the return is not quite "equal exactly when the data is":
 * it is that for the flat data this suite records, and no more.
 *
 * @param data - an entry's `metadata`, as it crosses the wire
 * @returns a rendering two of which are equal when the flat data is
 */
function canonical(data: Readonly<Record<string, unknown>>): string {
  return JSON.stringify(data, Object.keys(data).sort());
}

/**
 * Every member name an implementation offers: its own, and every prototype's up
 * to but not including `Object.prototype`.
 *
 * Both halves are needed. A method written as a class member lives on a
 * prototype and a method written as an instance arrow property lives on the
 * object, and an append-only rule that only looked at one of those would be a
 * rule somebody could satisfy by moving a line.
 *
 * @param service - the implementation under test
 * @returns every member name reachable on it, with duplicates left in
 */
function memberNames(service: IAuditService): string[] {
  const names: string[] = [];
  let layer: unknown = service;
  while (layer !== Object.prototype) {
    names.push(...Object.getOwnPropertyNames(layer as object));
    layer = Object.getPrototypeOf(layer as object) as unknown;
  }
  return names;
}

/**
 * The behavior every {@link IAuditService} implementation must exhibit.
 *
 * Each implementation drives this suite with its own runner's
 * `describe`/`it`/`expect`, which is what makes "they behave the same" a fact
 * the build checks rather than a claim a reviewer makes.
 *
 * Every assertion here has to be one an implementation can actually fail. The
 * entity helps less than usual: an {@link AuditEntry} refuses nothing, by
 * design, so there is no invariant for an assertion to lean on and quietly
 * become a tautology — but equally none to catch a bad value on the way past.
 * Every check below therefore compares what the service returned against
 * something the caller or the host supplied, never against the returned value
 * itself, and proves that what came back is a real entity rather than the row
 * behind it.
 *
 * What this suite deliberately does *not* assert is who may read. `query` takes
 * an actor because entitlement is real and about to matter, but what refusal
 * looks like for an actor who has none belongs to authorization, which is a
 * pure function in core and arrives in a later phase (ADR-0006). Pinning an
 * answer here would settle that question in the wrong place.
 *
 * @param deps - the host runner's primitives and a fresh-world factory
 */
export function runIAuditServiceContract(deps: IAuditServiceContractDeps): void {
  const { describe, it, expect, makeContext } = deps;

  describe('IAuditService conformance', () => {
    // Every promise on `AuditServiceContractContext`, asserted rather than
    // documented. A host that seeds its world wrong otherwise disarms the tests
    // below without failing anything: they would still pass, and they would be
    // proving nothing. Each one fails here instead, saying which promise broke.
    describe('the world the host promised', () => {
      it('holds exactly three entries, every one a real entity', async () => {
        const { seeded } = await makeContext();
        expect.equal(
          seeded.length,
          3,
          'the pagination test needs a page smaller than the history, and the two-filter test needs a third entry',
        );
        const impostors = seeded.filter((entry) => !(entry instanceof AuditEntry));
        expect.equal(impostors.length, 0, 'the promised entries must be entities, not the rows behind them');
      });

      it('holds them newest first, no two at the same instant', async () => {
        const { seeded } = await makeContext();
        const inOrder = seeded.filter((entry, index) => index === 0
          || seeded[index - 1].occurredAt.getTime() > entry.occurredAt.getTime());
        expect.equal(
          inOrder.length,
          seeded.length,
          'the promised entries must be strictly newest-first, or "newest first" is unfalsifiable',
        );
      });

      it('names one action on exactly one entry, and one actor on a different one', async () => {
        const { seeded, filterAction, filterActorId } = await makeContext();
        const byAction = seeded.filter((entry) => entry.action === filterAction);
        const byActor = seeded.filter((entry) => String(entry.actorId) === String(filterActorId));
        expect.equal(byAction.length, 1, 'filterAction must be carried by exactly one seeded entry');
        expect.equal(byActor.length, 1, 'filterActorId must be named by exactly one seeded entry');
        expect.ok(
          String(byAction[0].id) !== String(byActor[0].id),
          'the two filters must land on different entries, or narrowing by both proves nothing',
        );
      });

      it('holds nothing under the action the suite records with', async () => {
        const { seeded, freshAction } = await makeContext();
        const clashes = seeded.filter((entry) => entry.action === freshAction);
        expect.equal(
          clashes.length,
          0,
          'freshAction must be an action no seeded entry carries, or the tests below cannot find what they wrote',
        );
      });
    });

    describe('record', () => {
      // The count taken first is not scene-setting: it is what makes "one more"
      // mean something, and it is also where a reader who is not in fact
      // entitled to read across the deployment fails.
      it('makes an entry visible to query', async () => {
        const { service, readerId, seeded, freshAction } = await makeContext();
        const before = await service.query(readerId, wholeHistory());
        expect.equal(
          before.meta.total,
          seeded.length,
          'the world must start holding exactly the entries it promised, and the reader must be able to see them',
        );

        await service.record(recording(freshAction, readerId));

        const after = await service.query(readerId, wholeHistory());
        expect.equal(after.meta.total, seeded.length + 1, 'recording must leave one more entry than there was');
        const written = after.data.filter((entry) => entry.action === freshAction);
        expect.equal(written.length, 1, 'and the one more must be the entry that was recorded');
      });

      it('records the actor, action, resource and instant faithfully', async () => {
        const { service, readerId, freshAction } = await makeContext();
        const input = recording(freshAction, readerId, {
          resourceType: 'Article',
          resourceId: 'article-7',
          metadata: { title: 'On the margins' },
          clientAddress: '198.51.100.7',
          clientLabel: 'a client',
          occurredAt: new Date('2026-03-04T05:06:07.000Z'),
        });
        await service.record(input);

        const page = await service.query(readerId, wholeHistory({ action: freshAction }));
        expect.equal(page.data.length, 1, 'exactly the entry just recorded must come back');
        const entry = page.data[0];
        expect.ok(entry instanceof AuditEntry, 'query must return real entities, not the rows behind them');

        // Against the input, which is what the caller supplied — never against
        // the entry, which agrees with itself however wrong it is.
        expect.equal(String(entry.actorId), String(input.actorId), 'the entry must name who did it');
        // Less redundant with the filter above than it looks, and worth keeping
        // for the gap it covers: the filter matches on the stored row, this
        // reads the entity built from that row. A read mapping that mangles the
        // action after matching on it is caught here and nowhere else.
        expect.equal(entry.action, input.action, 'the entry must record what happened');
        expect.equal(entry.resourceType, input.resourceType, 'the entry must record what kind of thing it was about');
        expect.equal(entry.resourceId, input.resourceId, 'the entry must record which thing it was about');
        expect.equal(entry.clientAddress, input.clientAddress, 'the entry must record where it came from');
        expect.equal(entry.clientLabel, input.clientLabel, 'the entry must record what the client called itself');
        expect.equal(entry.organizationId, input.organizationId, 'the entry must record the tenant it happened in');
        expect.equal(
          entry.occurredAt.getTime(),
          input.occurredAt.getTime(),
          'the entry must record when it happened, not when the row was written',
        );
        expect.equal(canonical(entry.metadata), canonical(input.metadata), 'the entry must keep what else was said');
      });

      it('accepts a null actor, which an unauthenticated failed sign-in has', async () => {
        const { service, readerId, freshAction } = await makeContext();
        await service.record(recording(freshAction, null));

        const page = await service.query(readerId, wholeHistory({ action: freshAction }));
        expect.equal(page.data.length, 1, 'an entry nobody is the actor of must be recorded like any other');
        expect.equal(page.data[0].actorId, null, 'an absent actor must come back absent, not invented');
      });

      it('keeps every null it was given, rather than collapsing one into an absence', async () => {
        const { service, readerId, freshAction } = await makeContext();
        await service.record(recording(freshAction, readerId, {
          metadata: { previousDisplayName: null },
        }));

        const page = await service.query(readerId, wholeHistory({ action: freshAction }));
        // Before indexing, so that an implementation returning nothing reports
        // the promise it broke instead of throwing a TypeError off `data[0]`.
        expect.equal(page.data.length, 1, 'exactly the entry just recorded must come back');
        const entry = page.data[0];
        expect.equal(entry.resourceType, null, 'an entry about no thing must come back about no thing');
        expect.equal(entry.resourceId, null, 'an entry about no thing must come back about no thing');
        expect.equal(entry.clientAddress, null, 'an address nobody saw must come back unseen');
        expect.equal(entry.clientLabel, null, 'a label nobody offered must come back unoffered');
        expect.equal(
          entry.organizationId,
          null,
          'nothing this phase records belongs to a tenant, and belonging to none is a fact, not a gap (ADR-0007)',
        );

        // The one a mapping loses most often, and the loss is not cosmetic.
        // "it was previously nothing" and "we did not record what it was
        // previously" are different facts, and a store that drops a member
        // whose value is null turns the first into the second.
        expect.equal(
          'previousDisplayName' in entry.metadata,
          true,
          'a member recorded with a null value must survive as a member',
        );
        expect.equal(entry.metadata.previousDisplayName, null, 'and must survive with its null');
      });
    });

    describe('query', () => {
      it('returns newest first', async () => {
        const { service, readerId, seeded } = await makeContext();
        const page = await service.query(readerId, wholeHistory());
        expect.equal(
          page.data.map((entry) => String(entry.id)).join(','),
          seeded.map((entry) => String(entry.id)).join(','),
          'the whole history must come back in the order the world promised: newest first',
        );
      });

      it('filters by action', async () => {
        const { service, readerId, seeded, filterAction } = await makeContext();
        const wanted = seeded.filter((entry) => entry.action === filterAction)[0];

        const page = await service.query(readerId, wholeHistory({ action: filterAction }));
        expect.equal(page.meta.total, 1, 'narrowing by an action one entry carries must match one entry');
        expect.equal(page.data.length, 1, 'and must return that one entry');
        expect.equal(String(page.data[0].id), String(wanted.id), 'and it must be the entry that carries it');
      });

      it('filters by actor', async () => {
        const { service, readerId, seeded, filterActorId } = await makeContext();
        const wanted = seeded.filter((entry) => String(entry.actorId) === String(filterActorId))[0];

        const page = await service.query(readerId, wholeHistory({ actorId: filterActorId }));
        expect.equal(page.meta.total, 1, 'narrowing by an actor one entry names must match one entry');
        expect.equal(page.data.length, 1, 'and must return that one entry');
        expect.equal(String(page.data[0].id), String(wanted.id), 'and it must be the entry that names them');
      });

      // Nothing else pins this. Each filter above is satisfied by an
      // implementation that applies whichever one it happens to read first, or
      // that treats the two as alternatives — and every world where the filters
      // name the same entry leaves those implementations indistinguishable from
      // a correct one. The world promises they name different entries, so
      // narrowing by both must match nothing at all.
      it('narrows by every filter it is given, not by one of them', async () => {
        const { service, readerId, filterAction, filterActorId } = await makeContext();
        const page = await service.query(
          readerId,
          wholeHistory({ action: filterAction, actorId: filterActorId }),
        );
        expect.equal(page.meta.total, 0, 'an action and an actor from different entries must together match none');
        expect.equal(page.data.length, 0, 'and must return nothing');
        expect.equal(page.meta.totalPages, 0, 'no matches is no pages, not one empty one');
      });

      it('counts every match in meta.total, not the page', async () => {
        const { service, readerId, seeded } = await makeContext();
        const first = await service.query(readerId, { page: 1, limit: 2 });
        expect.equal(first.data.length, 2, 'a page must hold at most its limit');
        expect.equal(first.meta.total, seeded.length, 'the total must count every match, not the page');
        expect.equal(first.meta.page, 1, 'the page must say which page it is');
        expect.equal(first.meta.limit, 2, 'the page must say what it was limited to');
        expect.equal(
          first.meta.totalPages,
          Math.ceil(seeded.length / 2),
          'the page count must be derived from the total, not from the page',
        );

        const second = await service.query(readerId, { page: 2, limit: 2 });
        expect.equal(second.data.length, seeded.length - 2, 'the last page holds what the first one left');
        const firstIds = first.data.map((entry) => String(entry.id));
        const repeated = second.data.filter((entry) => firstIds.includes(String(entry.id)));
        expect.equal(repeated.length, 0, 'page 2 must not repeat a record from page 1');
      });
    });

    describe('wire shape', () => {
      // The one assertion that makes two independent implementations agree on
      // the shape crossing between them. Both sides are load-bearing: the left
      // is what the service produced and serialized, the right is the entry the
      // host promised. Comparing a round trip against itself would prove only
      // that the entity can serialize, which the entity's own tests already
      // establish and no implementation can get wrong.
      //
      // Ten fields rather than a sample, because the failure this catches is a
      // partial mapping — one column forgotten in a hand-written row-to-entity
      // function — and which column that is, is exactly what nobody knows in
      // advance. Handing back a raw store row fails a line earlier, on
      // `instanceof`.
      it('carries every field of a promised entry out through the wire shape', async () => {
        const { service, readerId, seeded } = await makeContext();
        const promised = seeded[0];
        const expected = promised.toJSON();

        const page = await service.query(readerId, wholeHistory());
        const fetched = page.data.filter((entry) => String(entry.id) === String(promised.id))[0];
        expect.ok(fetched, 'the promised entry must come back');
        expect.ok(fetched instanceof AuditEntry, 'query must return a real entity');

        // Compared BEFORE any round trip, and that is the whole point. Reviving
        // through `fromJSON` rebuilds the entity, so a round trip launders
        // exactly the faults this test exists to catch.
        const actual: AuditEntryJSON = fetched.toJSON();
        const field = (name: string): string => `the promised entry's ${name} must cross unchanged`;
        // Pinned already by the line that selected `fetched`, and kept so the
        // list below is visibly all ten fields rather than nine and a gap. What
        // actually catches an id the implementation lost is the `ok(fetched)`
        // above, where the entry simply never comes back.
        expect.equal(actual.id, expected.id, field('id'));
        expect.equal(actual.organizationId, expected.organizationId, field('organizationId'));
        expect.equal(actual.actorId, expected.actorId, field('actorId'));
        expect.equal(actual.action, expected.action, field('action'));
        expect.equal(actual.resourceType, expected.resourceType, field('resourceType'));
        expect.equal(actual.resourceId, expected.resourceId, field('resourceId'));
        expect.equal(canonical(actual.metadata), canonical(expected.metadata), field('metadata'));
        expect.equal(actual.clientAddress, expected.clientAddress, field('clientAddress'));
        expect.equal(actual.clientLabel, expected.clientLabel, field('clientLabel'));
        expect.equal(actual.occurredAt, expected.occurredAt, field('occurredAt'));

        // NOT the check its counterpart in the other three domains is, and the
        // difference is named here because the sentence that used to stand in
        // this place was carried over with the pattern and was false of this
        // entity. There, `fromJSON` re-runs an invariant and throws on a payload
        // that violates one, so making the call is itself an assertion. Here
        // there is no invariant to re-run — this entity refuses nothing at
        // construction, deliberately — and `actual` came out of a real entity
        // besides, so no run of this line can fail.
        //
        // It stays for a compile-time property, the way the auth suite's
        // `describeOutcome` exists for one: whatever `toJSON` emits must be
        // something `fromJSON` accepts, so the round trip between two
        // implementations is closed, and widening one side without the other
        // stops this file building. The run-time half of "they agree on the
        // shape between them" is the ten comparisons above, and only those.
        AuditEntry.fromJSON(actual);
      });
    });

    describe('the shape guarantee', () => {
      // A smoke alarm, not a lock. What it catches is the convenience method
      // somebody adds to an implementation one afternoon — `deleteEntry`,
      // `purgeOlderThan` — and it catches it the same day rather than in an
      // incident. What it cannot catch is a statement issued anywhere else, and
      // there is no shape of test that could: the guarantee is a database grant
      // that refuses the application role `UPDATE` and `DELETE` on this table,
      // added in the task after this one and proven against a live database by
      // D13. This assertion is the cheap half. Do not read it as the guarantee.
      it('offers record and query, and no member that could change an entry', async () => {
        const { service } = await makeContext();
        const names = memberNames(service);

        // Proven non-vacuous before it is trusted. An implementation whose
        // methods sit somewhere this search does not look would leave `names`
        // holding nothing relevant, and a search that found nothing at all
        // would satisfy the rule below without having looked at anything.
        expect.equal(names.includes('record'), true, 'the search must be able to see the implementation\'s members');
        expect.equal(names.includes('query'), true, 'the search must be able to see the implementation\'s members');

        const mutating = names.filter((name) => MUTATING.test(name));
        expect.equal(
          mutating.join(','),
          '',
          'an append-only service may offer no member that could change an entry',
        );
      });
    });
  });
}
