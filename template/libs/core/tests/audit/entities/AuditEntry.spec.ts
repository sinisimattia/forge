import { AuditEntry } from '__FORGE_SCOPE__/core/audit/entities';
import { AuditAction } from '__FORGE_SCOPE__/core/audit/enums';
import { makeAuditEntryJSON } from '__FORGE_SCOPE__/core/audit/testing';
import type { AuditEntryId, AuditEntryProps } from '__FORGE_SCOPE__/core/audit/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';

const HAPPENED = new Date('2026-01-01T00:00:00.000Z');

function makeProps(overrides: Partial<AuditEntryProps> = {}): AuditEntryProps {
  return {
    id: 'audit-1' as AuditEntryId,
    organizationId: null,
    actorId: 'user-1' as UserId,
    action: AuditAction.LOGIN_SUCCEEDED,
    resourceType: null,
    resourceId: null,
    metadata: {},
    clientAddress: null,
    clientLabel: null,
    occurredAt: HAPPENED,
    ...overrides,
  };
}

describe('AuditEntry', () => {
  // The entity refuses nothing, and that is a decision rather than an omission:
  // recording is not allowed to fail for a business reason, so there is no value
  // an entry may not carry. These pin the cases somebody would otherwise "fix"
  // into a guard.
  describe('what it accepts', () => {
    it('accepts an entry nobody is the actor of, which a failed sign-in is', () => {
      expect(new AuditEntry(makeProps({ actorId: null })).actorId).toBeNull();
    });

    it('accepts an entry belonging to no tenant, which a platform-level entry is', () => {
      expect(new AuditEntry(makeProps()).organizationId).toBeNull();
    });

    it('accepts an entry about no particular thing', () => {
      const entry = new AuditEntry(makeProps({ resourceType: null, resourceId: null }));
      expect(entry.resourceType).toBeNull();
      expect(entry.resourceId).toBeNull();
    });
  });

  describe('metadata', () => {
    // An append-only record that could be edited through the object its author
    // still holds would not be one.
    it('copies what it was given, so changing that afterwards changes no entry', () => {
      const given: Record<string, unknown> = { title: 'On the margins' };
      const entry = new AuditEntry(makeProps({ metadata: given }));
      given.title = 'Something else';
      expect(entry.metadata.title).toBe('On the margins');
    });

    it('freezes its copy, so the entry cannot be edited through itself either', () => {
      const entry = new AuditEntry(makeProps({ metadata: { title: 'On the margins' } }));
      expect(() => {
        (entry.metadata as Record<string, unknown>).title = 'Something else';
      }).toThrow(TypeError);
    });

    // Shallow, and pinned as shallow rather than left for somebody to discover.
    // Walking arbitrary caller data to freeze it deeply would buy very little:
    // the guarantee that holds is a privilege on the table, not this copy.
    it('freezes only the top level, which is the documented limit', () => {
      const nested: Record<string, unknown> = { was: 'Ada' };
      const entry = new AuditEntry(makeProps({ metadata: { previous: nested } }));
      nested.was = 'Grace';
      expect((entry.metadata.previous as Record<string, unknown>).was).toBe('Grace');
    });

    it('keeps a member recorded with a null value, rather than dropping it', () => {
      const entry = new AuditEntry(makeProps({ metadata: { previousDisplayName: null } }));
      expect('previousDisplayName' in entry.metadata).toBe(true);
      expect(entry.metadata.previousDisplayName).toBeNull();
    });
  });

  describe('what it carries', () => {
    it('has exactly the ten documented properties and no more', () => {
      expect(Object.keys(new AuditEntry(makeProps())).sort()).toEqual([
        'action',
        'actorId',
        'clientAddress',
        'clientLabel',
        'id',
        'metadata',
        'occurredAt',
        'organizationId',
        'resourceId',
        'resourceType',
      ]);
    });

    it('serializes exactly the ten documented keys and no more', () => {
      expect(Object.keys(new AuditEntry(makeProps()).toJSON()).sort()).toEqual([
        'action',
        'actorId',
        'clientAddress',
        'clientLabel',
        'id',
        'metadata',
        'occurredAt',
        'organizationId',
        'resourceId',
        'resourceType',
      ]);
    });
  });

  describe('toJSON', () => {
    it('renders the instant as an ISO-8601 string', () => {
      const json = new AuditEntry(makeProps({
        occurredAt: new Date('2026-01-02T03:04:05.000Z'),
      })).toJSON();
      expect(json.occurredAt).toBe('2026-01-02T03:04:05.000Z');
    });

    it('carries every null out as a null, not as an absence', () => {
      const json = new AuditEntry(makeProps({ actorId: null })).toJSON();
      expect(json.organizationId).toBeNull();
      expect(json.actorId).toBeNull();
      expect(json.resourceType).toBeNull();
      expect(json.resourceId).toBeNull();
      expect(json.clientAddress).toBeNull();
      expect(json.clientLabel).toBeNull();
    });
  });

  describe('fromJSON', () => {
    it('revives the instant as a date', () => {
      const entry = AuditEntry.fromJSON(makeAuditEntryJSON({
        occurredAt: '2026-01-02T03:04:05.000Z',
      }));
      expect(entry.occurredAt).toEqual(new Date('2026-01-02T03:04:05.000Z'));
    });

    // The row is deliberately spelled another way; the entity built from it is
    // canonical. This is the property the conformance suite's wire-shape test
    // leans on to tell a rebuilt entity from a store's own row.
    it('rewrites an instant stored in some other spelling of the same moment', () => {
      const entry = AuditEntry.fromJSON(makeAuditEntryJSON({
        occurredAt: '2026-01-01T00:00:00+00:00',
      }));
      expect(entry.toJSON().occurredAt).toBe('2026-01-01T00:00:00.000Z');
    });

    it('copies the row\'s metadata, so the store and the entry do not share one object', () => {
      const row = makeAuditEntryJSON({ metadata: { title: 'On the margins' } });
      const entry = AuditEntry.fromJSON(row);
      (row.metadata as Record<string, unknown>).title = 'Something else';
      expect(entry.metadata.title).toBe('On the margins');
    });

    it('carries every field of a row back out through toJSON', () => {
      const json = makeAuditEntryJSON({
        id: 'audit-7' as AuditEntryId,
        organizationId: null,
        actorId: 'user-7' as UserId,
        action: AuditAction.PROFILE_UPDATED,
        resourceType: 'Article',
        resourceId: 'article-7',
        metadata: { title: 'On the margins', previousTitle: null },
        clientAddress: '203.0.113.9',
        clientLabel: 'a client',
        occurredAt: '2026-05-06T07:08:09.000Z',
      });
      expect(AuditEntry.fromJSON(json).toJSON()).toEqual(json);
    });
  });
});
