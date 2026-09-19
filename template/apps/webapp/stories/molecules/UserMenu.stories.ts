import type { Meta, StoryObj } from '@storybook-vue/nuxt';
import UserMenu from '~/components/molecules/UserMenu.vue';

/**
 * `UserMenu` reads `useAuth()`, so what it renders depends on the auth store
 * rather than on args: with nobody signed in the avatar shows `?` and the name
 * is blank. Storybook has no session, so that is the state on show here — the
 * signed-in appearance is exercised by `AppHeader`'s stories and by the account
 * pages, both of which run against a real store.
 */
const meta = {
  title: 'Molecules/UserMenu',
  component: UserMenu,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
} satisfies Meta<typeof UserMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
