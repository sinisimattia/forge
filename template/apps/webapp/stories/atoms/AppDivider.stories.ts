import type { Meta, StoryObj } from '@storybook-vue/nuxt';
import AppDivider from '~/components/atoms/AppDivider.vue';

const meta = {
  title: 'Atoms/AppDivider',
  component: AppDivider,
  tags: ['autodocs'],
  argTypes: {
    direction: {
      control: 'select',
      options: ['horizontal', 'vertical'],
    },
    variant: {
      control: 'select',
      options: ['solid', 'dashed'],
    },
    color: {
      control: 'select',
      options: ['default', 'light'],
    },
    colorValue: { control: 'color' },
    spacing: {
      control: 'select',
      options: ['none', 'xs', 'sm', 'md', 'lg', 'xl'],
    },
  },
  decorators: [() => ({ template: '<div style="width: 300px;"><story /></div>' })],
} satisfies Meta<typeof AppDivider>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Horizontal: Story = {};

export const Dashed: Story = {
  args: { variant: 'dashed' },
};

export const CustomColorHex: Story = {
  args: { colorValue: '#1a1a1a' },
};

export const CustomColorRgba: Story = {
  args: { colorValue: 'rgba(99, 102, 241, 0.6)' },
};

export const WithSpacing: Story = {
  render: () => ({
    components: { AppDivider },
    template: `
      <div>
        <p style="margin: 0;">Content above</p>
        <AppDivider spacing="lg" />
        <p style="margin: 0;">Content below</p>
      </div>
    `,
  }),
};

export const Vertical: Story = {
  decorators: [
    () => ({ template: '<div style="display: flex; height: 60px;"><story /></div>' }),
  ],
  render: () => ({
    components: { AppDivider },
    template: `
      <div style="display: flex; align-items: center; gap: 1rem; height: 40px;">
        <span>Left</span>
        <AppDivider direction="vertical" />
        <span>Right</span>
      </div>
    `,
  }),
};
