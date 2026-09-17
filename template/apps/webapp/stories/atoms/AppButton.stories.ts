import type { Meta, StoryObj } from '@storybook-vue/nuxt';
import AppButton from '~/components/atoms/AppButton.vue';

const meta = {
  title: 'Atoms/AppButton',
  component: AppButton,
  tags: ['autodocs'],
  argTypes: {
    variant: { control: 'select', options: ['primary', 'secondary'] },
    disabled: { control: 'boolean' },
  },
  render: (args) => ({
    components: { AppButton },
    setup: () => ({ args }),
    template: '<AppButton v-bind="args">Button</AppButton>',
  }),
} satisfies Meta<typeof AppButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = { args: { variant: 'primary', disabled: false } };
export const Secondary: Story = { args: { variant: 'secondary', disabled: false } };
export const Disabled: Story = { args: { variant: 'primary', disabled: true } };
