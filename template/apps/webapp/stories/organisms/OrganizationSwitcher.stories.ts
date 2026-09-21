import type { Meta, StoryObj } from '@storybook-vue/nuxt';
import { Organization } from '__FORGE_SCOPE__/core/organizations/entities';
import type { OrganizationId } from '__FORGE_SCOPE__/core/organizations/types';
import OrganizationSwitcher from '~/components/organisms/OrganizationSwitcher.vue';

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

const meta = {
  title: 'Organisms/OrganizationSwitcher',
  component: OrganizationSwitcher,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
} satisfies Meta<typeof OrganizationSwitcher>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    organizations: [
      organization('org-1', 'Acme Works', 'acme-works'),
      organization('org-2', 'Northwind Traders', 'northwind-traders'),
    ],
  },
};

export const OneOrganization: Story = {
  args: {
    organizations: [organization('org-1', 'Acme Works', 'acme-works')],
  },
};

export const Empty: Story = {
  args: { organizations: [] },
};
