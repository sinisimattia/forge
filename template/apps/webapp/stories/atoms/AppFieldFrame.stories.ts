import type { Meta, StoryObj } from '@storybook-vue/nuxt';
import AppFieldFrame from '~/components/atoms/AppFieldFrame.vue';
import AppInput from '~/components/atoms/AppInput.vue';

const meta = {
  title: 'Atoms/AppFieldFrame',
  component: AppFieldFrame,
  tags: ['autodocs'],
  argTypes: {
    label: { control: 'text' },
    id: { control: 'text' },
    required: { control: 'boolean' },
    error: { control: 'text' },
  },
} satisfies Meta<typeof AppFieldFrame>;

export default meta;
type Story = StoryObj<typeof meta>;

const withControl = (args: Record<string, unknown>) => ({
  components: { AppFieldFrame, AppInput },
  setup: () => ({ args }),
  template: `
    <AppFieldFrame v-bind="args">
      <AppInput :id="args.id" placeholder="Type here" />
    </AppFieldFrame>
  `,
});

export const Default: Story = {
  args: { id: 'story-plain', label: 'Email address' },
  render: withControl,
};

export const Required: Story = {
  args: { id: 'story-required', label: 'Email address', required: true },
  render: withControl,
};

export const WithError: Story = {
  args: { id: 'story-error', label: 'Email address', error: 'That address is not valid.' },
  render: withControl,
};

/** No label at all: the label element is not rendered, not rendered empty. */
export const Unlabelled: Story = {
  args: { id: 'story-unlabelled' },
  render: withControl,
};
