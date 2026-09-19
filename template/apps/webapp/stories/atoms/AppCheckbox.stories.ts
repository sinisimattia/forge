import type { Meta, StoryObj } from '@storybook-vue/nuxt';
import AppCheckbox from '~/components/atoms/AppCheckbox.vue';

const meta = {
  title: 'Atoms/AppCheckbox',
  component: AppCheckbox,
  tags: ['autodocs'],
  argTypes: {
    modelValue: { control: 'boolean' },
    disabled: { control: 'boolean' },
    label: { control: 'text' },
  },
} satisfies Meta<typeof AppCheckbox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Unchecked: Story = {
  args: { modelValue: false },
};

export const Checked: Story = {
  args: { modelValue: true },
};

export const WithLabel: Story = {
  args: { modelValue: false, label: 'I agree to the terms' },
};

export const Disabled: Story = {
  args: { modelValue: true, label: 'Cannot change', disabled: true },
};
