import type { Meta, StoryObj } from '@storybook-vue/nuxt';
import AppLink from '~/components/atoms/AppLink.vue';

const meta = {
  title: 'Atoms/AppLink',
  component: AppLink,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['inline', 'nav', 'sidebar', 'button', 'button-outline', 'block'],
    },
    size: {
      control: 'select',
      options: ['sm', 'md'],
    },
    disabled: { control: 'boolean' },
  },
  render: (args) => ({
    components: { AppLink },
    setup: () => ({ args }),
    template: '<AppLink v-bind="args">Link text</AppLink>',
  }),
} satisfies Meta<typeof AppLink>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Inline: Story = {
  args: { variant: 'inline', to: '/' },
};

export const Nav: Story = {
  args: { variant: 'nav', to: '/' },
};

export const Sidebar: Story = {
  args: { variant: 'sidebar', to: '/' },
};

export const Button: Story = {
  args: { variant: 'button', to: '/' },
};

export const ButtonOutline: Story = {
  args: { variant: 'button-outline', to: '/' },
};

export const Block: Story = {
  render: () => ({
    components: { AppLink },
    template:
      '<AppLink variant="block" to="/" style="padding: 1rem;">Block link with content</AppLink>',
  }),
};

export const External: Story = {
  args: { variant: 'inline', href: 'https://example.com', target: '_blank' },
};

export const Disabled: Story = {
  args: { variant: 'inline', to: '/', disabled: true },
};
