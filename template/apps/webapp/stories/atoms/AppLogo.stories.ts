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
    // An absolute destination, to show `to` is not limited to an in-app route. Keep it on
    // `example.com` (RFC 2606's reserved documentation domain) like every other example in
    // this library — a real hostname here ships to every generated project and points a
    // stranger's users at a site nobody in the project controls.
    to: 'https://example.com',
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
