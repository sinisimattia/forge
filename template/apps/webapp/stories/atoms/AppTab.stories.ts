import type { Meta, StoryObj } from '@storybook-vue/nuxt';
import AppTab from '~/components/atoms/AppTab.vue';

const meta = {
  title: 'Atoms/AppTab',
  component: AppTab,
  tags: ['autodocs'],
  argTypes: {
    active: { control: 'boolean' },
    disabled: { control: 'boolean' },
    badge: { control: 'number' },
  },
  render: (args) => ({
    components: { AppTab },
    setup: () => ({ args }),
    template: '<AppTab v-bind="args">Overview</AppTab>',
  }),
} satisfies Meta<typeof AppTab>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {},
};

export const Active: Story = {
  args: { active: true },
};

export const Disabled: Story = {
  args: { disabled: true },
};

export const WithBadge: Story = {
  args: { badge: 3 },
};

export const ZeroBadgeIsHidden: Story = {
  // The badge renders only above zero — a count of nothing is noise, not information.
  args: { badge: 0 },
};

export const InARow: Story = {
  render: () => ({
    components: { AppTab },
    template: `
      <div role="tablist" style="display: flex; border-bottom: 1px solid #e5e7eb;">
        <AppTab active>Overview</AppTab>
        <AppTab :badge="2">Members</AppTab>
        <AppTab>Settings</AppTab>
        <AppTab disabled>Archived</AppTab>
      </div>
    `,
  }),
};
