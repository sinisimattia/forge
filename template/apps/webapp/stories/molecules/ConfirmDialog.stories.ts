import type { Meta, StoryObj } from '@storybook-vue/nuxt';
import ConfirmDialog from '~/components/molecules/ConfirmDialog.vue';

const meta = {
  title: 'Molecules/ConfirmDialog',
  component: ConfirmDialog,
  tags: ['autodocs'],
  argTypes: {
    open: { control: 'boolean' },
    title: { control: 'text' },
    message: { control: 'text' },
    confirmLabel: { control: 'text' },
    confirmVariant: {
      control: 'select',
      options: ['primary', 'secondary', 'ghost'],
    },
    loading: { control: 'boolean' },
  },
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof ConfirmDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    open: true,
    title: 'Delete item',
    message: 'Are you sure you want to delete this item? This action cannot be undone.',
  },
};

export const CustomLabel: Story = {
  args: {
    open: true,
    title: 'Revoke access',
    message: 'This member will no longer be able to sign in.',
    confirmLabel: 'Yes, revoke',
    confirmVariant: 'ghost',
  },
};

export const Loading: Story = {
  args: {
    open: true,
    title: 'Deleting...',
    message: 'Please wait while we delete this item.',
    loading: true,
  },
};

export const Closed: Story = {
  args: {
    open: false,
    title: 'Hidden',
    message: 'This dialog is not visible.',
  },
};
