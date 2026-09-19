import type { Meta, StoryObj } from '@storybook-vue/nuxt';
import { Session } from '__FORGE_SCOPE__/core/auth/entities';
import type { SessionId } from '__FORGE_SCOPE__/core/auth/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import SessionList from '~/components/organisms/SessionList.vue';

const OWNER = 'user-1' as UserId;

/**
 * Instants as fixed ISO-8601 strings rather than offsets from `Date.now()`, so
 * the rendered table is the same on every run and a visual diff means a change
 * in the component.
 */
function session(
  id: string,
  label: string | null,
  address: string | null,
  lastUsedAt: string,
): Session {
  return Session.fromJSON({
    id: id as SessionId,
    userId: OWNER,
    createdAt: '2026-09-01T09:00:00.000Z',
    lastUsedAt,
    expiresAt: '2026-10-01T09:00:00.000Z',
    revokedAt: null,
    clientAddress: address,
    clientLabel: label,
  });
}

const meta = {
  title: 'Organisms/SessionList',
  component: SessionList,
  tags: ['autodocs'],
  argTypes: { busy: { control: 'boolean' } },
  parameters: { layout: 'padded' },
} satisfies Meta<typeof SessionList>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The addresses below are from the documentation range reserved by RFC 5737 and
 * belong to nobody.
 */
export const Default: Story = {
  args: {
    sessions: [
      {
        session: session('session-1', 'Firefox on Linux', '203.0.113.7', '2026-09-18T18:30:00.000Z'),
        isCurrent: true,
      },
      {
        session: session('session-2', 'Safari on iOS', '198.51.100.24', '2026-09-17T07:05:00.000Z'),
        isCurrent: false,
      },
    ],
  },
};

/** What the server could tell about the client, when it could tell nothing. */
export const UnknownClient: Story = {
  args: {
    sessions: [
      { session: session('session-3', null, null, '2026-09-18T18:30:00.000Z'), isCurrent: false },
    ],
  },
};

/** One session, and it is the one being used: nothing here can be ended. */
export const OnlyTheCurrentOne: Story = {
  args: {
    sessions: [
      {
        session: session('session-1', 'Firefox on Linux', '203.0.113.7', '2026-09-18T18:30:00.000Z'),
        isCurrent: true,
      },
    ],
  },
};

export const Busy: Story = {
  args: { ...Default.args, busy: true },
};
