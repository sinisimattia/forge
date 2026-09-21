import type { Meta, StoryObj } from '@storybook-vue/nuxt';
import { Invitation } from '__FORGE_SCOPE__/core/organizations/entities';
import { InvitationStatus, OrgRole } from '__FORGE_SCOPE__/core/organizations/enums';
import type { InvitationId, OrganizationId } from '__FORGE_SCOPE__/core/organizations/types';

import InvitationList from '~/components/organisms/InvitationList.vue';

const ORG = 'org-1' as OrganizationId;

function invitation(id: string, email: string, role: OrgRole): Invitation {
  return Invitation.fromJSON({
    id: id as InvitationId,
    organizationId: ORG,
    email,
    role,
    status: InvitationStatus.PENDING,
    invitedByUserId: null,
    expiresAt: '2026-10-01T09:00:00.000Z',
    createdAt: '2026-09-01T09:00:00.000Z',
    acceptedAt: null,
    acceptedByUserId: null,
  });
}

const meta = {
  title: 'Organisms/InvitationList',
  component: InvitationList,
  tags: ['autodocs'],
  argTypes: { busy: { control: 'boolean' } },
  parameters: { layout: 'padded' },
} satisfies Meta<typeof InvitationList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ReadOnly: Story = {
  args: {
    invitations: [
      invitation('invitation-1', 'ada@example.test', OrgRole.MEMBER),
      invitation('invitation-2', 'grace@example.test', OrgRole.ADMIN),
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
  args: { invitations: [] },
};
