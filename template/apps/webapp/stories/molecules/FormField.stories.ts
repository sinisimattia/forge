import type { Meta, StoryObj } from '@storybook-vue/nuxt';
import FormField from '~/components/molecules/FormField.vue';
import AppInput from '~/components/atoms/AppInput.vue';

const meta = {
  title: 'Molecules/FormField',
  component: FormField,
  tags: ['autodocs'],
  argTypes: {
    label: { control: 'text' },
    error: { control: 'text' },
    required: { control: 'boolean' },
  },
} satisfies Meta<typeof FormField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { label: 'Email address' },
  render: (args) => ({
    components: { FormField, AppInput },
    setup: () => ({ args }),
    template: `
      <FormField v-bind="args">
        <AppInput placeholder="you@example.com" />
      </FormField>
    `,
  }),
};

export const Required: Story = {
  args: { label: 'Full name', required: true },
  render: (args) => ({
    components: { FormField, AppInput },
    setup: () => ({ args }),
    template: `
      <FormField v-bind="args">
        <AppInput placeholder="John Doe" />
      </FormField>
    `,
  }),
};

export const WithError: Story = {
  args: { label: 'Email address', error: 'Please enter a valid email', required: true },
  render: (args) => ({
    components: { FormField, AppInput },
    setup: () => ({ args }),
    template: `
      <FormField v-bind="args">
        <AppInput model-value="not-an-email" has-error />
      </FormField>
    `,
  }),
};
