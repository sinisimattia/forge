import type { Meta, StoryObj } from '@storybook-vue/nuxt';
import { Membership } from '__FORGE_SCOPE__/core/organizations/entities';
import { OrgRole } from '__FORGE_SCOPE__/core/organizations/enums';
import type { MembershipId, OrganizationId } from '__FORGE_SCOPE__/core/organizations/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import MemberList from '~/components/organisms/MemberList.vue';

const ORG = 'org-1' as OrganizationId;

function member(id: string, userId: string, role: OrgRole): Membership {
  return Membership.fromJSON({
    id: id as MembershipId,
    organizationId: ORG,
    userId: userId as UserId,
    role,
    createdAt: '2026-09-01T09:00:00.000Z',
    updatedAt: '2026-09-01T09:00:00.000Z',
  });
}

const meta = {
  title: 'Organisms/MemberList',
  component: MemberList,
  tags: ['autodocs'],
  argTypes: { busy: { control: 'boolean' } },
  parameters: { layout: 'padded' },
} satisfies Meta<typeof MemberList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ReadOnly: Story = {
  args: {
    members: [
      member('membership-1', 'user-1', OrgRole.OWNER),
      member('membership-2', 'user-2', OrgRole.MEMBER),
    ],
  },
};

/** An administrator's own view: every control is offered. */
export const Manageable: Story = {
  args: {
    ...ReadOnly.args,
    canChangeRole: true,
    canRemove: true,
  },
};

export const Busy: Story = {
  args: { ...Manageable.args, busy: true },
};
