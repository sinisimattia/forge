import type { Meta, StoryObj } from '@storybook-vue/nuxt';
import AppInput from '~/components/atoms/AppInput.vue';

const meta = {
  title: 'Atoms/AppInput',
  component: AppInput,
  tags: ['autodocs'],
  argTypes: {
    type: {
      control: 'select',
      options: ['text', 'email', 'password', 'tel', 'number', 'datetime-local'],
    },
    placeholder: { control: 'text' },
    disabled: { control: 'boolean' },
    hasError: { control: 'boolean' },
    modelValue: { control: 'text' },
  },
} satisfies Meta<typeof AppInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { placeholder: 'Enter text...' },
};

export const WithValue: Story = {
  args: { modelValue: 'Hello world' },
};

export const Email: Story = {
  args: { type: 'email', placeholder: 'you@example.com' },
};

export const Password: Story = {
  args: { type: 'password', placeholder: 'Enter password' },
};

export const Number: Story = {
  args: { type: 'number', placeholder: '0', min: 0, max: 100, step: 1 },
};

export const Error: Story = {
  args: { hasError: true, modelValue: 'Invalid value' },
};

export const Disabled: Story = {
  args: { disabled: true, modelValue: 'Cannot edit' },
};
