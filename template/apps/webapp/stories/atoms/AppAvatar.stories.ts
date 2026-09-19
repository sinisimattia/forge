import type { Meta, StoryObj } from '@storybook-vue/nuxt';
import AppAvatar from '~/components/atoms/AppAvatar.vue';

const meta = {
  title: 'Atoms/AppAvatar',
  component: AppAvatar,
  tags: ['autodocs'],
  argTypes: {
    initials: { control: 'text' },
    size: {
      control: 'select',
      options: ['sm', 'md'],
    },
  },
} satisfies Meta<typeof AppAvatar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { initials: 'AJ', size: 'sm' },
};

export const Small: Story = {
  args: { initials: 'AJ', size: 'sm' },
};

export const Medium: Story = {
  args: { initials: 'BS', size: 'md' },
};

export const SingleInitial: Story = {
  args: { initials: 'Z', size: 'md' },
};

export const AllSizes: Story = {
  render: () => ({
    components: { AppAvatar },
    template: `
      <div style="display: flex; gap: 1rem; align-items: center;">
        <AppAvatar initials="AJ" size="sm" />
        <AppAvatar initials="AJ" size="md" />
      </div>
    `,
  }),
};

export const SampleInitials: Story = {
  render: () => ({
    components: { AppAvatar },
    template: `
      <div style="display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap;">
        <AppAvatar initials="AJ" size="md" />
        <AppAvatar initials="BS" size="md" />
        <AppAvatar initials="CW" size="md" />
        <AppAvatar initials="DL" size="md" />
        <AppAvatar initials="Z" size="md" />
      </div>
    `,
  }),
};
