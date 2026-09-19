import type { Meta, StoryObj } from '@storybook-vue/nuxt';
import { ref } from 'vue';
import AppTabGroup from '~/components/molecules/AppTabGroup.vue';

const tabs = [
  { key: 'overview', label: 'Overview' },
  { key: 'members', label: 'Members', badge: 2 },
  { key: 'settings', label: 'Settings' },
  { key: 'archived', label: 'Archived', hidden: true },
];

const meta = {
  title: 'Molecules/AppTabGroup',
  component: AppTabGroup,
  tags: ['autodocs'],
  argTypes: {
    modelValue: { control: 'text' },
  },
} satisfies Meta<typeof AppTabGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { tabs, modelValue: 'overview' },
};

export const SecondTabSelected: Story = {
  args: { tabs, modelValue: 'members' },
};

// `hidden: true` removes a tab from the strip entirely — "Archived" is in the array above
// and must not appear here. Interactive so the v-model round-trip is visible: clicking a
// tab has no effect unless the parent writes the new key back.
export const Interactive: Story = {
  render: () => ({
    components: { AppTabGroup },
    setup() {
      const active = ref('overview');
      return { tabs, active };
    },
    template: `
      <div>
        <AppTabGroup :tabs="tabs" v-model="active" />
        <p style="margin-top: 1rem;">Active tab: {{ active }}</p>
      </div>
    `,
  }),
};
