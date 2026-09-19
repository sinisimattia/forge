import type { Meta, StoryObj } from '@storybook-vue/nuxt';
import AppText from '~/components/atoms/AppText.vue';

const meta = {
  title: 'Atoms/AppText',
  component: AppText,
  tags: ['autodocs'],
  argTypes: {
    as: {
      control: 'select',
      options: ['p', 'span', 'label', 'small', 'strong'],
    },
    size: {
      control: 'select',
      options: ['xs', 'sm', 'base', 'lg'],
    },
    color: {
      control: 'select',
      options: [
        'default',
        'muted',
        'secondary',
        'placeholder',
        'primary',
        'error',
        'success',
        'warning',
        'info',
        'white',
      ],
    },
    weight: {
      control: 'select',
      options: ['normal', 'medium', 'semibold', 'bold'],
    },
    uppercase: { control: 'boolean' },
    colorValue: { control: 'color' },
  },
  render: (args) => ({
    components: { AppText },
    setup: () => ({ args }),
    template: '<AppText v-bind="args">Sample text content</AppText>',
  }),
} satisfies Meta<typeof AppText>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Primary: Story = {
  args: { color: 'primary' },
};

export const ErrorText: Story = {
  args: { color: 'error' },
};

export const Label: Story = {
  args: { as: 'label', color: 'default' },
};

export const Uppercase: Story = {
  args: { uppercase: true, size: 'xs', weight: 'semibold' },
};

export const CustomColorHex: Story = {
  args: { colorValue: '#1a1a1a' },
};

export const CustomColorRgba: Story = {
  args: { colorValue: 'rgba(99, 102, 241, 0.8)' },
};

export const AllColors: Story = {
  render: () => ({
    components: { AppText },
    template: `
      <div style="display: flex; flex-direction: column; gap: 0.5rem;">
        <AppText color="default">Default</AppText>
        <AppText color="secondary">Secondary</AppText>
        <AppText color="muted">Muted</AppText>
        <AppText color="placeholder">Placeholder</AppText>
        <AppText color="primary">Primary</AppText>
        <AppText color="error">Error</AppText>
        <AppText color="success">Success</AppText>
        <AppText color="warning">Warning</AppText>
        <AppText color="info">Info</AppText>
      </div>
    `,
  }),
};
