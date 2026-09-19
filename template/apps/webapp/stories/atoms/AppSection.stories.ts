import type { Meta, StoryObj } from '@storybook-vue/nuxt';
import AppSection from '~/components/atoms/AppSection.vue';

const meta = {
  title: 'Atoms/AppSection',
  component: AppSection,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'muted', 'primary', 'dark'],
    },
    size: {
      control: 'select',
      options: ['sm', 'md', 'lg', 'xl'],
    },
    align: {
      control: 'select',
      options: ['left', 'center', 'right'],
    },
  },
  render: (args) => ({
    components: { AppSection },
    setup: () => ({ args }),
    template: '<AppSection v-bind="args"><p>Section content</p></AppSection>',
  }),
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof AppSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Muted: Story = {
  args: { variant: 'muted' },
};

export const Primary: Story = {
  args: { variant: 'primary', align: 'center' },
};

export const Dark: Story = {
  args: { variant: 'dark', align: 'center' },
};

export const Small: Story = {
  args: { size: 'sm' },
};

export const AllVariants: Story = {
  render: () => ({
    components: { AppSection },
    template: `
      <div>
        <AppSection variant="default" size="sm" align="center"><p>Default</p></AppSection>
        <AppSection variant="muted" size="sm" align="center"><p>Muted</p></AppSection>
        <AppSection variant="primary" size="sm" align="center"><p>Primary</p></AppSection>
        <AppSection variant="dark" size="sm" align="center"><p>Dark</p></AppSection>
      </div>
    `,
  }),
};
