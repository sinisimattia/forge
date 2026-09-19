import type { Meta, StoryObj } from '@storybook-vue/nuxt';
import AppSurface from '~/components/atoms/AppSurface.vue';

const meta = {
  title: 'Atoms/AppSurface',
  component: AppSurface,
  tags: ['autodocs'],
  argTypes: {
    backgroundColor: { control: 'color' },
    borderColor: { control: 'color' },
    as: {
      control: 'select',
      options: ['div', 'section', 'article'],
    },
  },
  render: (args) => ({
    components: { AppSurface },
    setup: () => ({ args }),
    template: `<AppSurface v-bind="args" style="padding: 1.5rem; border-radius: 0.5rem; border-width: 1px; border-style: solid;">Surface content goes here</AppSurface>`,
  }),
} satisfies Meta<typeof AppSurface>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithBackgroundColor: Story = {
  args: { backgroundColor: '#1a1a1a' },
};

export const WithRgbaBackground: Story = {
  args: { backgroundColor: 'rgba(99, 102, 241, 0.1)' },
};

export const WithBorderColor: Story = {
  args: { borderColor: '#6366f1' },
};

export const WithBackgroundAndBorder: Story = {
  args: {
    backgroundColor: 'rgba(99, 102, 241, 0.08)',
    borderColor: '#6366f1',
  },
};

export const AsSection: Story = {
  args: {
    as: 'section',
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderColor: '#10b981',
  },
};

export const AsArticle: Story = {
  args: {
    as: 'article',
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
    borderColor: '#ef4444',
  },
};
