import type { Meta, StoryObj } from '@storybook-vue/nuxt';
import LoginForm from '~/components/organisms/LoginForm.vue';

/**
 * There is one failure state and it is deliberately not a prop: the component
 * shows the same fixed string for every way signing in can fail, so there is
 * nothing here to vary. Submitting the form in Storybook reaches no backend and
 * therefore lands in exactly that state, which is the one worth looking at.
 */
const meta = {
  title: 'Organisms/LoginForm',
  component: LoginForm,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
} satisfies Meta<typeof LoginForm>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
