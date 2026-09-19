import type { Meta, StoryObj } from '@storybook-vue/nuxt';
import AppContainer from '~/components/atoms/AppContainer.vue';

const meta = {
  title: 'Atoms/AppContainer',
  component: AppContainer,
  tags: ['autodocs'],
  argTypes: {
    size: {
      control: 'select',
      options: ['xs', 'sm', 'md', 'lg', 'xl'],
    },
    as: {
      control: 'select',
      options: ['div', 'section', 'main', 'article', 'nav'],
    },
    padded: { control: 'boolean' },
  },
  render: (args) => ({
    components: { AppContainer },
    setup: () => ({ args }),
    template:
      '<AppContainer v-bind="args"><div style="background: #f0f0f0; padding: 1rem;">Container content</div></AppContainer>',
  }),
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof AppContainer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const ExtraSmall: Story = {
  args: { size: 'xs' },
};

export const Small: Story = {
  args: { size: 'sm' },
};

export const Medium: Story = {
  args: { size: 'md' },
};

export const ExtraLarge: Story = {
  args: { size: 'xl' },
};

export const NoPadding: Story = {
  args: { padded: false },
};
