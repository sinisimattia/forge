import type { Meta, StoryObj } from '@storybook-vue/nuxt';
import AppCard from '~/components/atoms/AppCard.vue';

const meta = {
  title: 'Atoms/AppCard',
  component: AppCard,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'elevated', 'inset', 'empty'],
    },
    padding: {
      control: 'select',
      options: ['none', 'sm', 'md', 'lg', 'xl', '2xl'],
    },
    as: {
      control: 'select',
      options: ['div', 'section', 'article'],
    },
  },
  render: (args) => ({
    components: { AppCard },
    setup: () => ({ args }),
    template: '<AppCard v-bind="args">Card content goes here</AppCard>',
  }),
} satisfies Meta<typeof AppCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Elevated: Story = {
  args: { variant: 'elevated' },
};

export const Inset: Story = {
  args: { variant: 'inset' },
};

export const Empty: Story = {
  args: { variant: 'empty' },
};

export const NoPadding: Story = {
  args: { padding: 'none' },
};

export const AllVariants: Story = {
  render: () => ({
    components: { AppCard },
    template: `
      <div style="display: flex; flex-direction: column; gap: 1rem; width: 300px;">
        <AppCard variant="default">Default card</AppCard>
        <AppCard variant="elevated">Elevated card</AppCard>
        <AppCard variant="inset">Inset card</AppCard>
        <AppCard variant="empty">Empty state card</AppCard>
      </div>
    `,
  }),
};
