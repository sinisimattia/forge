import type { Meta, StoryObj } from '@storybook-vue/nuxt';
import AppStack from '~/components/atoms/AppStack.vue';

const meta = {
  title: 'Atoms/AppStack',
  component: AppStack,
  tags: ['autodocs'],
  argTypes: {
    direction: {
      control: 'select',
      options: ['row', 'column'],
    },
    gap: {
      control: 'select',
      options: ['none', 'xs', 'sm', 'md', 'lg', 'xl', '2xl'],
    },
    align: {
      control: 'select',
      options: ['start', 'center', 'end', 'stretch', 'baseline'],
    },
    justify: {
      control: 'select',
      options: ['start', 'center', 'end', 'between'],
    },
    wrap: { control: 'boolean' },
    grow: { control: 'boolean' },
    shrink: { control: 'boolean' },
  },
} satisfies Meta<typeof AppStack>;

export default meta;
type Story = StoryObj<typeof meta>;

const boxStyle
  = 'background: #e0e7ff; padding: 0.75rem 1rem; border-radius: 0.375rem; text-align: center;';

export const Column: Story = {
  args: { gap: 'md' },
  render: (args) => ({
    components: { AppStack },
    setup: () => ({ args }),
    template: `
      <AppStack v-bind="args">
        <div style="${boxStyle}">Item 1</div>
        <div style="${boxStyle}">Item 2</div>
        <div style="${boxStyle}">Item 3</div>
      </AppStack>
    `,
  }),
};

export const Row: Story = {
  args: { direction: 'row', gap: 'md' },
  render: (args) => ({
    components: { AppStack },
    setup: () => ({ args }),
    template: `
      <AppStack v-bind="args">
        <div style="${boxStyle}">Item 1</div>
        <div style="${boxStyle}">Item 2</div>
        <div style="${boxStyle}">Item 3</div>
      </AppStack>
    `,
  }),
};

export const RowBetween: Story = {
  args: { direction: 'row', gap: 'md', justify: 'between' },
  render: (args) => ({
    components: { AppStack },
    setup: () => ({ args }),
    template: `
      <AppStack v-bind="args" style="width: 400px;">
        <div style="${boxStyle}">Left</div>
        <div style="${boxStyle}">Right</div>
      </AppStack>
    `,
  }),
};

export const Centered: Story = {
  args: { direction: 'column', gap: 'md', align: 'center', justify: 'center' },
  render: (args) => ({
    components: { AppStack },
    setup: () => ({ args }),
    template: `
      <AppStack v-bind="args" style="height: 200px; border: 1px dashed #ccc;">
        <div style="${boxStyle}">Centered</div>
      </AppStack>
    `,
  }),
};
