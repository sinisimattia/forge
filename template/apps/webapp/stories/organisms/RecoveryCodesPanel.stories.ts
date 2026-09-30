import type { Meta, StoryObj } from '@storybook-vue/nuxt';
import RecoveryCodesPanel from '~/components/organisms/RecoveryCodesPanel.vue';

const meta = {
  title: 'Organisms/RecoveryCodesPanel',
  component: RecoveryCodesPanel,
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
} satisfies Meta<typeof RecoveryCodesPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The warning comes first, the codes follow, and "Done" stays disabled until the
 * person says they have kept them. These codes are made up and open nothing.
 */
export const Default: Story = {
  args: {
    codes: [
      'K7QD-M2XW-9P4R',
      'H3TB-Z8NC-5V6J',
      'W9FA-R4YE-2L7S',
      'C5GM-X6PD-8T3N',
      'R2VJ-B9KA-4H7Q',
      'N8ZE-F3LW-6Y2C',
      'S4XT-D7QM-9B5G',
      'P6HR-J2NV-3K8A',
      'Y9CL-W5FE-7D4Z',
      'M3BQ-T8GX-2R6H',
    ],
  },
};
