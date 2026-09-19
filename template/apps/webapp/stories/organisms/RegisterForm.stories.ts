import type { Meta, StoryObj } from '@storybook-vue/nuxt';
import RegisterForm from '~/components/organisms/RegisterForm.vue';

const meta = {
  title: 'Organisms/RegisterForm',
  component: RegisterForm,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
} satisfies Meta<typeof RegisterForm>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
