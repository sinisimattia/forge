import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { Organization } from '__FORGE_SCOPE__/core/organizations/entities';
import type { OrganizationId } from '__FORGE_SCOPE__/core/organizations/types';
import OrganizationSwitcher from '../organisms/OrganizationSwitcher.vue';
import { mountOptions, stubAutoImports } from './harness';

function organization(id: string, name: string, slug: string): Organization {
  return Organization.fromJSON({
    id: id as OrganizationId,
    name,
    slug,
    createdAt: '2026-09-01T09:00:00.000Z',
    updatedAt: '2026-09-01T09:00:00.000Z',
    deletedAt: null,
  });
}

const FIRST = organization('org-1', 'Acme Works', 'acme-works');
const SECOND = organization('org-2', 'Northwind Traders', 'northwind-traders');

describe('OrganizationSwitcher', () => {
  beforeEach(() => {
    stubAutoImports();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function list(organizations: Organization[]) {
    return mount(OrganizationSwitcher, { props: { organizations }, global: mountOptions() });
  }

  it('renders one row per organization', () => {
    expect(list([FIRST, SECOND]).findAll('tbody tr')).toHaveLength(2);
  });

  it('shows each organization\'s own name and slug', () => {
    const text = list([FIRST, SECOND]).text();
    expect(text).toContain('Acme Works');
    expect(text).toContain('acme-works');
    expect(text).toContain('Northwind Traders');
    expect(text).toContain('northwind-traders');
  });

  it('links each row to that organization\'s own members screen, not always the first', () => {
    // `.html()`, not `.text()`: the differentiator is the `href` an anchor
    // carries, which `.text()` cannot see at all.
    const html = list([FIRST, SECOND]).html();
    expect(html).toContain('href="/organizations/org-1/members"');
    expect(html).toContain('href="/organizations/org-2/members"');
  });

  it('renders no row with nothing to show', () => {
    expect(list([]).findAll('tbody tr')).toHaveLength(0);
  });
});
