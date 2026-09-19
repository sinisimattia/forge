import type { Meta, StoryObj } from '@storybook-vue/nuxt';
import AppOverlay from '~/components/atoms/AppOverlay.vue';

const meta = {
  title: 'Atoms/AppOverlay',
  component: AppOverlay,
  tags: ['autodocs'],
  argTypes: {
    open: { control: 'boolean' },
    closeOnBackdrop: { control: 'boolean' },
  },
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof AppOverlay>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {
  args: { open: true },
  render: (args) => ({
    components: { AppOverlay },
    setup: () => ({ args }),
    template: `
      <div style="height: 300px; position: relative;">
        <p>Background content</p>
        <AppOverlay v-bind="args">
          <div style="background: white; padding: 2rem; border-radius: 0.5rem; box-shadow: 0 4px 12px rgba(0,0,0,0.15);">
            Overlay content
          </div>
        </AppOverlay>
      </div>
    `,
  }),
};

export const Closed: Story = {
  args: { open: false },
  render: (args) => ({
    components: { AppOverlay },
    setup: () => ({ args }),
    template: `
      <div style="height: 300px;">
        <p>Background content (overlay is closed)</p>
        <AppOverlay v-bind="args">
          <div>You should not see this</div>
        </AppOverlay>
      </div>
    `,
  }),
};
