import type { Meta, StoryObj } from '@storybook-vue/nuxt';
import AppIcon from '~/components/atoms/AppIcon.vue';

const meta = {
  title: 'Atoms/AppIcon',
  component: AppIcon,
  tags: ['autodocs'],
  argTypes: {
    name: {
      control: 'select',
      options: ['chevron-down', 'check'],
    },
    size: {
      control: 'select',
      options: ['sm', 'md', 'lg'],
    },
  },
} satisfies Meta<typeof AppIcon>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { name: 'chevron-down', size: 'md' },
};

export const ChevronDown: Story = {
  args: { name: 'chevron-down', size: 'md' },
};

export const Check: Story = {
  args: { name: 'check', size: 'md' },
};

export const Small: Story = {
  args: { name: 'check', size: 'sm' },
};

export const Large: Story = {
  args: { name: 'chevron-down', size: 'lg' },
};

export const ColoredViaText: Story = {
  render: () => ({
    components: { AppIcon },
    template: `
      <div style="display: flex; gap: 1.5rem; align-items: center;">
        <span class="text-primary-600"><AppIcon name="check" size="md" /></span>
        <span class="text-error-600"><AppIcon name="check" size="md" /></span>
        <span class="text-success-600"><AppIcon name="check" size="md" /></span>
        <span class="text-warning-600"><AppIcon name="chevron-down" size="md" /></span>
        <span class="text-neutral-400"><AppIcon name="chevron-down" size="md" /></span>
      </div>
    `,
  }),
};

export const AllSizes: Story = {
  render: () => ({
    components: { AppIcon },
    template: `
      <div style="display: flex; gap: 1.5rem; align-items: center;">
        <AppIcon name="check" size="sm" />
        <AppIcon name="check" size="md" />
        <AppIcon name="check" size="lg" />
      </div>
    `,
  }),
};

export const AllIcons: Story = {
  render: () => ({
    components: { AppIcon },
    template: `
      <div style="display: flex; gap: 1.5rem; align-items: center;">
        <div style="display: flex; flex-direction: column; align-items: center; gap: 0.25rem;">
          <AppIcon name="chevron-down" size="md" />
          <span style="font-size: 0.75rem; color: #6b7280;">chevron-down</span>
        </div>
        <div style="display: flex; flex-direction: column; align-items: center; gap: 0.25rem;">
          <AppIcon name="check" size="md" />
          <span style="font-size: 0.75rem; color: #6b7280;">check</span>
        </div>
      </div>
    `,
  }),
};
