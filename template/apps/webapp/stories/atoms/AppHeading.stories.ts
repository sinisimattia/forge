import type { Meta, StoryObj } from '@storybook-vue/nuxt';
import AppHeading from '~/components/atoms/AppHeading.vue';

const meta = {
  title: 'Atoms/AppHeading',
  component: AppHeading,
  tags: ['autodocs'],
  argTypes: {
    as: {
      control: 'select',
      options: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
    },
    size: {
      control: 'select',
      options: ['hero', 'xl', 'lg', 'md', 'sm', 'xs', 'xxs'],
    },
    color: {
      control: 'select',
      options: ['default', 'primary', 'muted', 'error', 'white'],
    },
    colorValue: { control: 'color' },
  },
  render: (args) => ({
    components: { AppHeading },
    setup: () => ({ args }),
    template: '<AppHeading v-bind="args">Heading Text</AppHeading>',
  }),
} satisfies Meta<typeof AppHeading>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Hero: Story = {
  args: { size: 'hero', as: 'h1' },
};

export const Primary: Story = {
  args: { size: 'lg', color: 'primary' },
};

export const Muted: Story = {
  args: { size: 'md', color: 'muted' },
};

export const Error: Story = {
  args: { size: 'sm', color: 'error' },
};

export const CustomColorHex: Story = {
  args: { colorValue: '#1a1a1a' },
};

export const CustomColorRgba: Story = {
  args: { colorValue: 'rgba(99, 102, 241, 0.9)', size: 'lg', as: 'h2' },
};

export const AllSizes: Story = {
  render: () => ({
    components: { AppHeading },
    template: `
      <div style="display: flex; flex-direction: column; gap: 0.75rem;">
        <AppHeading size="hero" as="h1">Hero</AppHeading>
        <AppHeading size="xl" as="h2">Extra Large</AppHeading>
        <AppHeading size="lg" as="h2">Large</AppHeading>
        <AppHeading size="md" as="h3">Medium</AppHeading>
        <AppHeading size="sm" as="h4">Small</AppHeading>
        <AppHeading size="xs" as="h5">Extra Small</AppHeading>
        <AppHeading size="xxs" as="h6">XXS</AppHeading>
      </div>
    `,
  }),
};
