import type { Meta, StoryObj } from '@storybook-vue/nuxt';
import AppSpinner from '~/components/atoms/AppSpinner.vue';

const meta = {
  title: 'Atoms/AppSpinner',
  component: AppSpinner,
  tags: ['autodocs'],
  argTypes: {
    size: {
      control: 'select',
      options: ['sm', 'md', 'lg'],
    },
  },
} satisfies Meta<typeof AppSpinner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Small: Story = {
  args: { size: 'sm' },
};

export const Medium: Story = {
  args: { size: 'md' },
};

export const Large: Story = {
  args: { size: 'lg' },
};

export const AllSizes: Story = {
  render: () => ({
    components: { AppSpinner },
    template: `
      <div style="display: flex; align-items: center; gap: 1.5rem;">
        <AppSpinner size="sm" />
        <AppSpinner size="md" />
        <AppSpinner size="lg" />
      </div>
    `,
  }),
};
