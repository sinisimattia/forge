import type { Meta, StoryObj } from '@storybook-vue/nuxt';
import AppButton from '~/components/atoms/AppButton.vue';

const meta = {
  title: 'Atoms/AppButton',
  component: AppButton,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['primary', 'secondary', 'ghost', 'unstyled'],
    },
    size: {
      control: 'select',
      options: ['sm', 'md', 'lg'],
    },
    type: {
      control: 'select',
      options: ['button', 'submit', 'reset'],
    },
    disabled: { control: 'boolean' },
    loading: { control: 'boolean' },
  },
  render: (args) => ({
    components: { AppButton },
    setup: () => ({ args }),
    template: '<AppButton v-bind="args">Click me</AppButton>',
  }),
} satisfies Meta<typeof AppButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: { variant: 'primary' },
};

export const Secondary: Story = {
  args: { variant: 'secondary' },
};

export const Ghost: Story = {
  args: { variant: 'ghost' },
};

export const Small: Story = {
  args: { size: 'sm' },
};

export const Large: Story = {
  args: { size: 'lg' },
};

export const Disabled: Story = {
  args: { disabled: true },
};

export const Loading: Story = {
  args: { loading: true },
};

export const Unstyled: Story = {
  render: (args) => ({
    components: { AppButton },
    setup: () => ({ args }),
    template: `
      <AppButton v-bind="args" class="flex items-center gap-1 text-primary-600 underline hover:text-primary-800">
        Bare clickable region — caller supplies all styling
      </AppButton>
    `,
  }),
  args: { variant: 'unstyled' },
};

export const AllVariants: Story = {
  render: () => ({
    components: { AppButton },
    template: `
      <div style="display: flex; align-items: center; gap: 1rem; flex-wrap: wrap;">
        <AppButton variant="primary">Primary</AppButton>
        <AppButton variant="secondary">Secondary</AppButton>
        <AppButton variant="ghost">Ghost</AppButton>
        <AppButton variant="unstyled" class="text-primary-600 underline">Unstyled</AppButton>
      </div>
    `,
  }),
};
