import type { Meta, StoryObj } from '@storybook-vue/nuxt';
import { AuthIdentity } from '__FORGE_SCOPE__/core/identities/entities';
import { AuthProvider } from '__FORGE_SCOPE__/core/identities/enums';
import type { AuthIdentityId } from '__FORGE_SCOPE__/core/identities/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import IdentityList from '~/components/organisms/IdentityList.vue';

const OWNER = 'user-1' as UserId;

function identity(
  id: string,
  provider: AuthProvider,
  providerAccountId: string,
  lastUsedAt: string | null,
): AuthIdentity {
  return AuthIdentity.fromJSON({
    id: id as AuthIdentityId,
    userId: OWNER,
    provider,
    providerAccountId,
    createdAt: '2026-09-01T09:00:00.000Z',
    lastUsedAt,
  });
}

const meta = {
  title: 'Organisms/IdentityList',
  component: IdentityList,
  tags: ['autodocs'],
  argTypes: { busy: { control: 'boolean' } },
  parameters: { layout: 'padded' },
} satisfies Meta<typeof IdentityList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Addresses below are in the `example.test` domain, reserved by RFC 6761. */
export const Several: Story = {
  args: {
    identities: [
      identity('identity-1', AuthProvider.PASSWORD, 'ada@example.test', '2026-09-18T18:30:00.000Z'),
      identity('identity-2', AuthProvider.GOOGLE, '117392044118', null),
    ],
  },
};

/** The last one left: there is no control to remove it. */
export const TheLastOne: Story = {
  args: {
    identities: [
      identity('identity-1', AuthProvider.PASSWORD, 'ada@example.test', '2026-09-18T18:30:00.000Z'),
    ],
  },
};

/**
 * One held identity, and one configured provider still open to link. The
 * unlink control stays hidden — one identity is one identity, whether or not
 * another provider could be added — while the link row offers the provider
 * this account does not hold yet.
 */
export const OffersToLink: Story = {
  args: {
    identities: [
      identity('identity-1', AuthProvider.PASSWORD, 'ada@example.test', '2026-09-18T18:30:00.000Z'),
    ],
    providers: [AuthProvider.GOOGLE],
  },
};

export const Busy: Story = {
  args: { ...Several.args, busy: true },
};
