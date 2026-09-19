import type { Meta, StoryObj } from '@storybook-vue/nuxt';
import AppAlert from '~/components/atoms/AppAlert.vue';

const meta = {
  title: 'Atoms/AppAlert',
  component: AppAlert,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['error', 'warning', 'success', 'info', 'primary'],
    },
    density: {
      control: 'select',
      options: ['compact', 'default', 'spacious'],
    },
  },
  render: (args) => ({
    components: { AppAlert },
    setup: () => ({ args }),
    template: '<AppAlert v-bind="args">This is an alert message.</AppAlert>',
  }),
} satisfies Meta<typeof AppAlert>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Error: Story = {
  args: { variant: 'error' },
};

export const Warning: Story = {
  args: { variant: 'warning' },
};

export const Success: Story = {
  args: { variant: 'success' },
};

export const Info: Story = {
  args: { variant: 'info' },
};

export const Primary: Story = {
  args: { variant: 'primary' },
};

export const Compact: Story = {
  args: { variant: 'info', density: 'compact' },
};

export const Spacious: Story = {
  args: { variant: 'success', density: 'spacious' },
};

export const AllVariants: Story = {
  render: () => ({
    components: { AppAlert },
    template: `
      <div style="display: flex; flex-direction: column; gap: 0.75rem; width: 400px;">
        <AppAlert variant="error">Error: Something went wrong.</AppAlert>
        <AppAlert variant="warning">Warning: Check your input.</AppAlert>
        <AppAlert variant="success">Success: Operation completed.</AppAlert>
        <AppAlert variant="info">Info: Here is some information.</AppAlert>
        <AppAlert variant="primary">Primary: Welcome aboard.</AppAlert>
      </div>
    `,
  }),
};
