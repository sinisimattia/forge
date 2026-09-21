import type { Meta, StoryObj } from '@storybook-vue/nuxt';
import type { GrantId, ResourceGrant, ResourceType } from '__FORGE_SCOPE__/core/authorization/types';
import type { OrganizationId } from '__FORGE_SCOPE__/core/organizations/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import GrantList from '~/components/organisms/GrantList.vue';

const ORG = 'org-1' as OrganizationId;

function grant(id: string, subjectUserId: string, expiresAt: string | null): ResourceGrant {
  return {
    id: id as GrantId,
    subjectUserId: subjectUserId as UserId,
    organizationId: ORG,
    resourceType: 'document' as ResourceType,
    resourceId: 'doc-1',
    permission: 'grant:read',
    grantedBy: 'user-1' as UserId,
    createdAt: new Date('2026-09-01T09:00:00.000Z'),
    expiresAt: expiresAt === null ? null : new Date(expiresAt),
  };
}

const meta = {
  title: 'Organisms/GrantList',
  component: GrantList,
  tags: ['autodocs'],
  argTypes: { busy: { control: 'boolean' } },
  parameters: { layout: 'padded' },
} satisfies Meta<typeof GrantList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ReadOnly: Story = {
  args: {
    grants: [
      grant('grant-1', 'user-2', '2026-12-01T00:00:00.000Z'),
      grant('grant-2', 'user-3', null),
    ],
  },
};

export const Revocable: Story = {
  args: { ...ReadOnly.args, canRevoke: true },
};

export const Busy: Story = {
  args: { ...Revocable.args, busy: true },
};

export const Empty: Story = {
  args: { grants: [] },
};
