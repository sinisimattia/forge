import type { Meta, StoryObj } from '@storybook-vue/nuxt';
import AppTextarea from '~/components/atoms/AppTextarea.vue';

const meta = {
  title: 'Atoms/AppTextarea',
  component: AppTextarea,
  tags: ['autodocs'],
  argTypes: {
    placeholder: { control: 'text' },
    disabled: { control: 'boolean' },
    hasError: { control: 'boolean' },
    rows: { control: 'number' },
    modelValue: { control: 'text' },
  },
} satisfies Meta<typeof AppTextarea>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { placeholder: 'Write something...' },
};

export const WithValue: Story = {
  args: { modelValue: 'Some longer text content that spans multiple lines.' },
};

export const Error: Story = {
  args: { hasError: true, modelValue: 'Invalid content' },
};

export const Disabled: Story = {
  args: { disabled: true, modelValue: 'Read only' },
};

export const CustomRows: Story = {
  args: { rows: 8, placeholder: 'Tall textarea...' },
};
