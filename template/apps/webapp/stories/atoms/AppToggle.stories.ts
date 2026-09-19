import type { Meta, StoryObj } from '@storybook-vue/nuxt';
import AppToggle from '~/components/atoms/AppToggle.vue';

const meta = {
  title: 'Atoms/AppToggle',
  component: AppToggle,
  tags: ['autodocs'],
  argTypes: {
    modelValue: { control: 'boolean' },
    disabled: { control: 'boolean' },
    label: { control: 'text' },
    description: { control: 'text' },
  },
} satisfies Meta<typeof AppToggle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Off: Story = {
  args: { modelValue: false },
};

export const On: Story = {
  args: { modelValue: true },
};

export const WithLabel: Story = {
  args: { modelValue: true, label: 'Enable notifications' },
};

export const WithDescription: Story = {
  args: {
    modelValue: false,
    label: 'Dark mode',
    description: 'Use dark theme across the application',
  },
};

export const Disabled: Story = {
  args: { modelValue: true, label: 'Locked setting', disabled: true },
};
