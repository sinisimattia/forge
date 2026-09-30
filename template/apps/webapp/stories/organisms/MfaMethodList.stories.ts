import type { Meta, StoryObj } from '@storybook-vue/nuxt';
import { MfaMethodType } from '__FORGE_SCOPE__/core/mfa/enums';
import type { MfaMethodId, MfaMethodJSON } from '__FORGE_SCOPE__/core/mfa/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import MfaMethodList from '~/components/organisms/MfaMethodList.vue';

const OWNER = 'user-1' as UserId;

function method(
  id: string,
  type: MfaMethodType,
  label: string,
  confirmedAt: string | null,
  lastUsedAt: string | null,
): MfaMethodJSON {
  return {
    id: id as MfaMethodId,
    userId: OWNER,
    type,
    label,
    createdAt: '2026-09-01T09:00:00.000Z',
    confirmedAt,
    lastUsedAt,
  };
}

const meta = {
  title: 'Organisms/MfaMethodList',
  component: MfaMethodList,
  tags: ['autodocs'],
  argTypes: { busy: { control: 'boolean' } },
  parameters: { layout: 'padded' },
} satisfies Meta<typeof MfaMethodList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Several: Story = {
  args: {
    methods: [
      method('method-1', MfaMethodType.TOTP, 'Phone', '2026-09-01T09:05:00.000Z', '2026-09-18T18:30:00.000Z'),
      method('method-2', MfaMethodType.WEBAUTHN, 'Office key', '2026-09-03T10:00:00.000Z', null),
    ],
  },
};

/** The last one is still removable; the server decides whether that needs a proof. */
export const TheOnlyOne: Story = {
  args: {
    methods: [
      method('method-1', MfaMethodType.TOTP, 'Phone', '2026-09-01T09:05:00.000Z', null),
    ],
  },
};

/** Enrollment started and never finished: it gates nothing, and says so. */
export const SetupNotFinished: Story = {
  args: {
    methods: [
      method('method-1', MfaMethodType.TOTP, 'Phone', '2026-09-01T09:05:00.000Z', '2026-09-18T18:30:00.000Z'),
      method('method-2', MfaMethodType.TOTP, 'Tablet', null, null),
    ],
  },
};

export const Busy: Story = {
  args: { ...Several.args, busy: true },
};
