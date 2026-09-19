import type { Meta, StoryObj } from '@storybook-vue/nuxt';
import AppGrid from '~/components/atoms/AppGrid.vue';

const meta = {
  title: 'Atoms/AppGrid',
  component: AppGrid,
  tags: ['autodocs'],
  argTypes: {
    cols: {
      control: 'select',
      options: [1, 2, 3, 4],
    },
    colsSm: {
      control: 'select',
      options: [1, 2, 3, 4],
    },
    colsMd: {
      control: 'select',
      options: [1, 2, 3, 4],
    },
    colsLg: {
      control: 'select',
      options: [1, 2, 3, 4],
    },
    gap: {
      control: 'select',
      options: ['none', 'xs', 'sm', 'md', 'lg', 'xl', '2xl'],
    },
  },
} satisfies Meta<typeof AppGrid>;

export default meta;
type Story = StoryObj<typeof meta>;

const boxStyle
  = 'background: #e0e7ff; padding: 1rem; border-radius: 0.375rem; text-align: center;';

export const TwoColumns: Story = {
  args: { cols: 2, gap: 'md' },
  render: (args) => ({
    components: { AppGrid },
    setup: () => ({ args }),
    template: `
      <AppGrid v-bind="args">
        <div style="${boxStyle}">1</div>
        <div style="${boxStyle}">2</div>
        <div style="${boxStyle}">3</div>
        <div style="${boxStyle}">4</div>
      </AppGrid>
    `,
  }),
};

export const ThreeColumns: Story = {
  args: { cols: 3, gap: 'lg' },
  render: (args) => ({
    components: { AppGrid },
    setup: () => ({ args }),
    template: `
      <AppGrid v-bind="args">
        <div style="${boxStyle}">1</div>
        <div style="${boxStyle}">2</div>
        <div style="${boxStyle}">3</div>
        <div style="${boxStyle}">4</div>
        <div style="${boxStyle}">5</div>
        <div style="${boxStyle}">6</div>
      </AppGrid>
    `,
  }),
};

export const Responsive: Story = {
  args: { cols: 1, colsSm: 2, colsLg: 4, gap: 'md' },
  render: (args) => ({
    components: { AppGrid },
    setup: () => ({ args }),
    template: `
      <AppGrid v-bind="args">
        <div style="${boxStyle}">1</div>
        <div style="${boxStyle}">2</div>
        <div style="${boxStyle}">3</div>
        <div style="${boxStyle}">4</div>
      </AppGrid>
    `,
  }),
};
