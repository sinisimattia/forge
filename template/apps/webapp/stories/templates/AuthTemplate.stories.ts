import type { Meta, StoryObj } from '@storybook-vue/nuxt';
import AuthTemplate from '~/components/templates/AuthTemplate.vue';
import AppButton from '~/components/atoms/AppButton.vue';
import AppInput from '~/components/atoms/AppInput.vue';
import AppLink from '~/components/atoms/AppLink.vue';
import FormField from '~/components/molecules/FormField.vue';

const meta = {
  title: 'Templates/AuthTemplate',
  component: AuthTemplate,
  tags: ['autodocs'],
  argTypes: {
    title: { control: 'text' },
    subtitle: { control: 'text' },
  },
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof AuthTemplate>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { title: 'Sign in' },
  render: (args) => ({
    components: { AuthTemplate, AppButton, AppInput, FormField },
    setup: () => ({ args }),
    template: `
      <AuthTemplate v-bind="args">
        <FormField label="Email" id="email">
          <AppInput id="email" type="email" placeholder="you@example.com" />
        </FormField>
        <FormField label="Password" id="password">
          <AppInput id="password" type="password" />
        </FormField>
        <AppButton type="submit">Sign in</AppButton>
      </AuthTemplate>
    `,
  }),
};

export const WithSubtitleAndFooter: Story = {
  args: { title: 'Create an account', subtitle: 'It takes less than a minute.' },
  render: (args) => ({
    components: { AuthTemplate, AppButton, AppInput, AppLink, FormField },
    setup: () => ({ args }),
    template: `
      <AuthTemplate v-bind="args">
        <FormField label="Email" id="signup-email">
          <AppInput id="signup-email" type="email" placeholder="you@example.com" />
        </FormField>
        <AppButton type="submit">Create account</AppButton>
        <template #footer>
          Already have one? <AppLink to="/login">Sign in</AppLink>
        </template>
      </AuthTemplate>
    `,
  }),
};
