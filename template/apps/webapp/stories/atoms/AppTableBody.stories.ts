import type { Meta, StoryObj } from '@storybook-vue/nuxt';
import AppTable from '~/components/atoms/AppTable.vue';
import AppTableBody from '~/components/atoms/AppTableBody.vue';
import AppTableRow from '~/components/atoms/AppTableRow.vue';
import AppTableCell from '~/components/atoms/AppTableCell.vue';

const meta = {
  title: 'Atoms/AppTableBody',
  component: AppTableBody,
  tags: ['autodocs'],
} satisfies Meta<typeof AppTableBody>;

export default meta;
type Story = StoryObj<typeof meta>;

// Shown inside AppTable: a bare `tbody` outside a `table` is invalid markup and browsers
// relocate it, so the component would not appear at all on its own.
export const Default: Story = {
  render: () => ({
    components: { AppTable, AppTableBody, AppTableRow, AppTableCell },
    template: `
      <AppTable>
        <AppTableBody>
          <AppTableRow>
            <AppTableCell emphasis="primary">Alice Johnson</AppTableCell>
            <AppTableCell>alice@example.com</AppTableCell>
          </AppTableRow>
          <AppTableRow>
            <AppTableCell emphasis="primary">Bob Smith</AppTableCell>
            <AppTableCell>bob@example.com</AppTableCell>
          </AppTableRow>
        </AppTableBody>
      </AppTable>
    `,
  }),
};

export const Empty: Story = {
  render: () => ({
    components: { AppTable, AppTableBody, AppTableRow, AppTableCell },
    template: `
      <AppTable>
        <AppTableBody>
          <AppTableRow>
            <AppTableCell :colspan="2" emphasis="muted">Nothing here yet.</AppTableCell>
          </AppTableRow>
        </AppTableBody>
      </AppTable>
    `,
  }),
};
