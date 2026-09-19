import type { Meta, StoryObj } from '@storybook-vue/nuxt';
import AppRadioGroup from '~/components/atoms/AppRadioGroup.vue';

const sampleOptions = [
  { value: 'public', label: 'Public', description: 'Anyone can see this' },
  { value: 'unlisted', label: 'Unlisted', description: 'Only people with the link' },
  { value: 'private', label: 'Private', description: 'Only you' },
];

const meta = {
  title: 'Atoms/AppRadioGroup',
  component: AppRadioGroup,
  tags: ['autodocs'],
  argTypes: {
    disabled: { control: 'boolean' },
    modelValue: { control: 'text' },
  },
} satisfies Meta<typeof AppRadioGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { name: 'visibility', options: sampleOptions },
};

export const WithSelection: Story = {
  args: { name: 'visibility', options: sampleOptions, modelValue: 'unlisted' },
};

export const Disabled: Story = {
  args: { name: 'visibility', options: sampleOptions, modelValue: 'public', disabled: true },
};
