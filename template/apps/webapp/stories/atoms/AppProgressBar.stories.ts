import type { Meta, StoryObj } from '@storybook-vue/nuxt';
import AppProgressBar from '~/components/atoms/AppProgressBar.vue';

const meta = {
  title: 'Atoms/AppProgressBar',
  component: AppProgressBar,
  tags: ['autodocs'],
  argTypes: {
    percentage: { control: { type: 'range', min: 0, max: 100, step: 1 } },
    color: {
      control: 'select',
      options: ['primary', 'success', 'warning', 'error'],
    },
    size: {
      control: 'select',
      options: ['sm', 'md'],
    },
    showLabel: { control: 'boolean' },
  },
  decorators: [() => ({ template: '<div style="width: 300px;"><story /></div>' })],
} satisfies Meta<typeof AppProgressBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { percentage: 60 },
};

export const WithLabel: Story = {
  args: { percentage: 75, showLabel: true },
};

export const Success: Story = {
  args: { percentage: 100, color: 'success', showLabel: true },
};

export const Warning: Story = {
  args: { percentage: 45, color: 'warning' },
};

export const Error: Story = {
  args: { percentage: 20, color: 'error' },
};

export const Small: Story = {
  args: { percentage: 50, size: 'sm' },
};

export const AllColors: Story = {
  render: () => ({
    components: { AppProgressBar },
    template: `
      <div style="display: flex; flex-direction: column; gap: 1rem; width: 300px;">
        <AppProgressBar :percentage="80" color="primary" show-label />
        <AppProgressBar :percentage="100" color="success" show-label />
        <AppProgressBar :percentage="50" color="warning" show-label />
        <AppProgressBar :percentage="25" color="error" show-label />
      </div>
    `,
  }),
};
