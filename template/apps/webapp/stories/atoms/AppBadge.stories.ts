import type { Meta, StoryObj } from '@storybook-vue/nuxt';
import AppBadge from '~/components/atoms/AppBadge.vue';

const meta = {
  title: 'Atoms/AppBadge',
  component: AppBadge,
  tags: ['autodocs'],
  argTypes: {
    color: {
      control: 'select',
      options: ['neutral', 'success', 'warning', 'error', 'primary', 'info'],
    },
    size: {
      control: 'select',
      options: ['sm', 'md'],
    },
  },
  render: (args) => ({
    components: { AppBadge },
    setup: () => ({ args }),
    template: '<AppBadge v-bind="args">Badge</AppBadge>',
  }),
} satisfies Meta<typeof AppBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Neutral: Story = {
  args: { color: 'neutral' },
};

export const Success: Story = {
  args: { color: 'success' },
};

export const Warning: Story = {
  args: { color: 'warning' },
};

export const Error: Story = {
  args: { color: 'error' },
};

export const Primary: Story = {
  args: { color: 'primary' },
};

export const Info: Story = {
  args: { color: 'info' },
};

export const Small: Story = {
  args: { size: 'sm', color: 'primary' },
};

export const AllColors: Story = {
  render: () => ({
    components: { AppBadge },
    template: `
      <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
        <AppBadge color="neutral">Neutral</AppBadge>
        <AppBadge color="success">Success</AppBadge>
        <AppBadge color="warning">Warning</AppBadge>
        <AppBadge color="error">Error</AppBadge>
        <AppBadge color="primary">Primary</AppBadge>
        <AppBadge color="info">Info</AppBadge>
      </div>
    `,
  }),
};
