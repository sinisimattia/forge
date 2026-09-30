import type { Meta, StoryObj } from '@storybook-vue/nuxt';
import MfaChallengeForm from '~/components/organisms/MfaChallengeForm.vue';
import { useAuthStore } from '~/stores/auth';

/**
 * The second step of signing in. What it offers depends on what the store holds,
 * so each story sets that up before the form is built.
 *
 * Submitting reaches no backend here, so a submission lands in the one failure
 * state the form has: a single message for every way this can go wrong, and —
 * because the backend spends a challenge on any attempt — the way back to sign
 * in instead of a second try.
 */
const meta = {
  title: 'Organisms/MfaChallengeForm',
  component: MfaChallengeForm,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
} satisfies Meta<typeof MfaChallengeForm>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Arrived by the federated redirect: a challenge, and no list of methods. */
export const MethodsUnknown: Story = {
  decorators: [
    () => {
      useAuthStore().adoptChallenge('story-only-challenge');
      return { template: '<story />' };
    },
  ],
};

/** Nothing is held — what the form shows once a challenge has been spent. */
export const ChallengeSpent: Story = {
  decorators: [
    () => {
      useAuthStore().abandonChallenge();
      return { template: '<story />' };
    },
  ],
};
