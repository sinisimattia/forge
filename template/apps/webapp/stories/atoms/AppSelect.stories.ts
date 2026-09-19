import type { Meta, StoryObj } from '@storybook-vue/nuxt';
import AppSelect from '~/components/atoms/AppSelect.vue';

const sampleOptions = [
  { value: 'opt1', label: 'Option 1' },
  { value: 'opt2', label: 'Option 2' },
  { value: 'opt3', label: 'Option 3' },
];

const meta = {
  title: 'Atoms/AppSelect',
  component: AppSelect,
  tags: ['autodocs'],
  argTypes: {
    placeholder: { control: 'text' },
    disabled: { control: 'boolean' },
    hasError: { control: 'boolean' },
    modelValue: { control: 'text' },
  },
} satisfies Meta<typeof AppSelect>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { options: sampleOptions, placeholder: 'Choose an option' },
};

export const WithSelection: Story = {
  args: { options: sampleOptions, modelValue: 'opt2' },
};

export const Error: Story = {
  args: { options: sampleOptions, hasError: true },
};

export const Disabled: Story = {
  args: { options: sampleOptions, disabled: true, modelValue: 'opt1' },
};
