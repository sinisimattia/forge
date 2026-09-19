import type { Meta, StoryObj } from '@storybook-vue/nuxt';
import PasswordField from '~/components/molecules/PasswordField.vue';

const meta = {
  title: 'Molecules/PasswordField',
  component: PasswordField,
  tags: ['autodocs'],
  argTypes: {
    label: { control: 'text' },
    id: { control: 'text' },
    disabled: { control: 'boolean' },
    autocomplete: { control: 'select', options: ['current-password', 'new-password'] },
    checkPolicy: { control: 'boolean' },
    error: { control: 'text' },
  },
} satisfies Meta<typeof PasswordField>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Proving a secret already held: the policy is deliberately not applied. */
export const SigningIn: Story = {
  args: { id: 'story-signin', label: 'Password' },
};

/** Choosing a secret: the policy is applied as it is typed. */
export const ChoosingOne: Story = {
  args: {
    id: 'story-choose',
    label: 'New password',
    autocomplete: 'new-password',
    checkPolicy: true,
    modelValue: 'short',
  },
};

/** A refusal the server sent back, including one this side cannot judge. */
export const RefusedByTheServer: Story = {
  args: {
    id: 'story-refused',
    label: 'New password',
    autocomplete: 'new-password',
    reportedViolations: ['BREACHED'],
    modelValue: 'a well known phrase',
  },
};

export const Disabled: Story = {
  args: { id: 'story-disabled', label: 'Password', disabled: true },
};

export const WithServerMessage: Story = {
  args: { id: 'story-error', label: 'Password', error: 'That is not your current password.' },
};
