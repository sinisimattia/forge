import { Organization } from '__FORGE_SCOPE__/core/organizations/entities';
import {
  InvalidOrganizationSlugError,
  OrganizationNameRequiredError,
} from '__FORGE_SCOPE__/core/organizations/errors';
import type {
  OrganizationId,
  OrganizationJSON,
  OrganizationProps,
} from '__FORGE_SCOPE__/core/organizations/types';

const CREATED_AT = new Date('2026-01-01T00:00:00.000Z');
const UPDATED_AT = new Date('2026-01-02T00:00:00.000Z');
const DELETED_AT = new Date('2026-02-01T00:00:00.000Z');

function makeProps(overrides: Partial<OrganizationProps> = {}): OrganizationProps {
  return {
    id: 'a3f1c2d4-0000-4000-8000-000000000001' as OrganizationId,
    name: '  Acme Works  ',
    slug: 'acme-works',
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    deletedAt: null,
    ...overrides,
  };
}

describe('Organization', () => {
  it('trims the name, because the name is what a person reads', () => {
    expect(new Organization(makeProps()).name).toBe('Acme Works');
  });

  it('refuses a name that is only whitespace', () => {
    expect(() => new Organization(makeProps({ name: '   ' })))
      .toThrow(OrganizationNameRequiredError);
  });

  // The slug is not derived from the name here, and that is the decision this
  // test records. Deriving it would make two organizations named "Acme Works"
  // collide on a value neither of them chose, and would make renaming an
  // organization silently change every URL that names it. The caller supplies
  // it; the entity only refuses one that cannot be in a path.
  it('refuses a slug that is not usable in a path', () => {
    for (const bad of ['Acme Works', 'acme_works', 'acme works', '-acme', 'acme-', '', 'ACME']) {
      expect(() => new Organization(makeProps({ slug: bad })))
        .toThrow(InvalidOrganizationSlugError);
    }
  });

  it('names the offending value in the InvalidOrganizationSlugError message', () => {
    expect(() => new Organization(makeProps({ slug: 'ACME' })))
      .toThrow('"ACME" is not a usable organization slug.');
  });

  it('accepts the slugs a generated project will actually produce', () => {
    for (const good of ['acme', 'acme-works', 'a1', 'acme-works-2']) {
      expect(new Organization(makeProps({ slug: good })).slug).toBe(good);
    }
  });

  describe('isDeleted', () => {
    it('is false while the instant is null', () => {
      expect(new Organization(makeProps({ deletedAt: null })).isDeleted).toBe(false);
    });

    it('is true once the instant is set', () => {
      expect(new Organization(makeProps({ deletedAt: DELETED_AT })).isDeleted).toBe(true);
    });
  });

  describe('toJSON', () => {
    it('renders instants as ISO-8601 strings and a null deletedAt as null', () => {
      const json = new Organization(makeProps()).toJSON();
      expect(json.createdAt).toBe('2026-01-01T00:00:00.000Z');
      expect(json.updatedAt).toBe('2026-01-02T00:00:00.000Z');
      expect(json.deletedAt).toBeNull();
    });

    it('renders a set deletedAt as an ISO-8601 string', () => {
      const json = new Organization(makeProps({ deletedAt: DELETED_AT })).toJSON();
      expect(json.deletedAt).toBe('2026-02-01T00:00:00.000Z');
    });
  });

  describe('fromJSON', () => {
    it('round-trips through its wire shape with every instant revived', () => {
      const original = new Organization(makeProps());
      const revived = Organization.fromJSON(original.toJSON());
      expect(revived).toBeInstanceOf(Organization);
      expect(revived.createdAt).toBeInstanceOf(Date);
      expect(revived.createdAt.toISOString()).toBe(CREATED_AT.toISOString());
    });

    it('revives a set deletedAt as a Date', () => {
      const json = new Organization(makeProps({ deletedAt: DELETED_AT })).toJSON();
      expect(Organization.fromJSON(json).deletedAt).toEqual(DELETED_AT);
    });

    it('re-runs every invariant, so a blank name is rejected on the way back in', () => {
      const json: OrganizationJSON = { ...new Organization(makeProps()).toJSON(), name: '   ' };
      expect(() => Organization.fromJSON(json)).toThrow(OrganizationNameRequiredError);
    });
  });
});
