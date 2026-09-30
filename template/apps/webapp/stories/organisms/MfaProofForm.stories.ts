import type { Meta, StoryObj } from '@storybook-vue/nuxt';
import { MfaMethodType } from '__FORGE_SCOPE__/core/mfa/enums';
import type { MfaMethodId, MfaMethodJSON } from '__FORGE_SCOPE__/core/mfa/types';
import type { UserId } from '__FORGE_SCOPE__/core/users/types';
import MfaProofForm from '~/components/organisms/MfaProofForm.vue';

const PHONE: MfaMethodJSON = {
  id: 'method-1' as MfaMethodId,
  userId: 'user-1' as UserId,
  type: MfaMethodType.TOTP,
  label: 'Phone',
  createdAt: '2026-09-01T09:00:00.000Z',
  confirmedAt: '2026-09-01T09:05:00.000Z',
  lastUsedAt: null,
};

const meta = {
  title: 'Organisms/MfaProofForm',
  component: MfaProofForm,
  tags: ['autodocs'],
  argTypes: { busy: { control: 'boolean' } },
  parameters: { layout: 'centered' },
} satisfies Meta<typeof MfaProofForm>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Removing the last method, with no proof sent yet: an explanation, not an error. */
export const RequiredToRemove: Story = {
  args: { action: 'remove', reason: 'required', methods: [PHONE] },
};

/** A proof was sent and refused: a different message, in the error style. */
export const WrongProof: Story = {
  args: { action: 'remove', reason: 'wrong', methods: [PHONE] },
};

export const RequiredToRegenerate: Story = {
  args: { action: 'regenerate', reason: 'required', methods: [PHONE] },
};

/** No authenticator app to supply a code — only a recovery code is offered. */
export const RecoveryCodeOnly: Story = {
  args: { action: 'remove', reason: 'required', methods: [] },
};
