import type { Meta, StoryObj } from '@storybook-vue/nuxt';
import { AuthProvider } from '__FORGE_SCOPE__/core/identities/enums';
import OAuthButtons from '~/components/organisms/OAuthButtons.vue';

const meta = {
  title: 'Organisms/OAuthButtons',
  component: OAuthButtons,
  tags: ['autodocs'],
  argTypes: { busy: { control: 'boolean' } },
  parameters: { layout: 'padded' },
} satisfies Meta<typeof OAuthButtons>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Several: Story = {
  args: {
    providers: [AuthProvider.GOOGLE, AuthProvider.GITHUB, AuthProvider.OIDC],
  },
};

export const OneProvider: Story = {
  args: {
    providers: [AuthProvider.GOOGLE],
  },
};

export const Busy: Story = {
  args: { ...Several.args, busy: true },
};

/**
 * ADR-0008: an unconfigured provider is absent from the login page — this
 * story renders nothing, on purpose, rather than a heading with nothing
 * beneath it. It exists so the empty case is a state a reader can select in
 * Storybook, not only an assertion in `OAuthButtons.spec.ts`.
 */
export const NoneConfigured: Story = {
  args: {
    providers: [],
  },
};
