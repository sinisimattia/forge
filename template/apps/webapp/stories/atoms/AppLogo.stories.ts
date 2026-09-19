import type { Meta, StoryObj } from '@storybook-vue/nuxt';
import AppLogo from '~/components/atoms/AppLogo.vue';

const meta = {
  title: 'Atoms/AppLogo',
  component: AppLogo,
  tags: ['autodocs'],
  argTypes: {
    size: {
      control: 'select',
      options: ['inherit', 'small', 'regular', 'large', 'huge'],
    },
    to: { control: 'text' },
  },
} satisfies Meta<typeof AppLogo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Small: Story = {
  args: { size: 'small' },
};

export const Regular: Story = {
  args: { size: 'regular' },
};

export const Large: Story = {
  args: { size: 'large' },
};

export const Huge: Story = {
  args: {
    size: 'huge',
    to: 'https://snisni.it',
  },
};

export const AllSizes: Story = {
  render: () => ({
    components: { AppLogo },
    template: `
      <div style="display: flex; align-items: center; gap: 2rem;">
        <AppLogo size="small" />
        <AppLogo size="regular" />
        <AppLogo size="large" />
        <AppLogo size="huge" />
      </div>
    `,
  }),
};
