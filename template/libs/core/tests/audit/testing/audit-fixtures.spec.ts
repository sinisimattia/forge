import { AuditAction } from '__FORGE_SCOPE__/core/audit/enums';
import { makeAuditEntryJSON } from '__FORGE_SCOPE__/core/audit/testing';
import type { AuditEntryId } from '__FORGE_SCOPE__/core/audit/types';

describe('makeAuditEntryJSON', () => {
  // Against the literal, not against a function of the value under test: the
  // latter holds for whatever the fixture happens to return, so it could not fail.
  it('defaults to a successful sign-in, which is the commonest entry there is', () => {
    expect(makeAuditEntryJSON().action).toBe(AuditAction.LOGIN_SUCCEEDED);
  });

  it('defaults to belonging to no tenant, which is every entry this phase writes', () => {
    expect(makeAuditEntryJSON().organizationId).toBeNull();
  });

  it('defaults to naming an actor', () => {
    expect(makeAuditEntryJSON().actorId).toBe('user-1');
  });

  it('defaults to being about no particular thing', () => {
    expect(makeAuditEntryJSON().resourceType).toBeNull();
    expect(makeAuditEntryJSON().resourceId).toBeNull();
  });

  it('defaults to knowing nothing about the client', () => {
    expect(makeAuditEntryJSON().clientAddress).toBeNull();
    expect(makeAuditEntryJSON().clientLabel).toBeNull();
  });

  it('defaults to having nothing extra to say', () => {
    expect(makeAuditEntryJSON().metadata).toEqual({});
  });

  it('defaults to a fixed instant, so a test that pins one does not chase the clock', () => {
    expect(makeAuditEntryJSON().occurredAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('lets an override win over the default', () => {
    const json = makeAuditEntryJSON({
      id: 'audit-9' as AuditEntryId,
      action: AuditAction.ACCOUNT_DELETED,
    });
    expect(json.id).toBe('audit-9');
    expect(json.action).toBe(AuditAction.ACCOUNT_DELETED);
    expect(json.occurredAt).toBe('2026-01-01T00:00:00.000Z');
  });
});
