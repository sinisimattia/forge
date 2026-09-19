import type { Meta, StoryObj } from '@storybook-vue/nuxt';
import AppHeader from '~/components/organisms/AppHeader.vue';

/**
 * `AppHeader` reads `useAuth()`. With no session it renders the signed-out pair
 * of links, which is what Storybook shows; the signed-in branch swaps them for
 * `UserMenu`.
 */
const meta = {
  title: 'Organisms/AppHeader',
  component: AppHeader,
  tags: ['autodocs'],
  argTypes: {
    containerSize: { control: 'select', options: ['xs', 'sm', 'md', 'lg', 'xl', 'full'] },
  },
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof AppHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Narrow: Story = {
  args: { containerSize: 'md' },
};
