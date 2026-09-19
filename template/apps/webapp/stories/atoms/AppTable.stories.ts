import type { Meta, StoryObj } from '@storybook-vue/nuxt';
import AppTable from '~/components/atoms/AppTable.vue';
import AppTableHead from '~/components/atoms/AppTableHead.vue';
import AppTableBody from '~/components/atoms/AppTableBody.vue';
import AppTableCell from '~/components/atoms/AppTableCell.vue';

const meta = {
  title: 'Atoms/AppTable',
  component: AppTable,
  tags: ['autodocs'],
} satisfies Meta<typeof AppTable>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithColspan: Story = {
  render: () => ({
    components: { AppTable, AppTableHead, AppTableBody, AppTableCell },
    template: `
      <AppTable>
        <AppTableHead>
          <AppTableCell header>Name</AppTableCell>
          <AppTableCell header>Details</AppTableCell>
        </AppTableHead>
        <AppTableBody>
          <tr>
            <AppTableCell emphasis="primary">Alice Johnson</AppTableCell>
            <AppTableCell>alice@example.com</AppTableCell>
          </tr>
          <tr>
            <AppTableCell :colspan="2" emphasis="muted">— No further records —</AppTableCell>
          </tr>
        </AppTableBody>
      </AppTable>
    `,
  }),
};

export const Default: Story = {
  render: () => ({
    components: { AppTable, AppTableHead, AppTableBody, AppTableCell },
    template: `
      <AppTable>
        <AppTableHead>
          <AppTableCell header>Name</AppTableCell>
          <AppTableCell header>Email</AppTableCell>
          <AppTableCell header align="right">Status</AppTableCell>
        </AppTableHead>
        <AppTableBody>
          <tr>
            <AppTableCell emphasis="primary">Alice Johnson</AppTableCell>
            <AppTableCell>alice@example.com</AppTableCell>
            <AppTableCell align="right" emphasis="muted">Active</AppTableCell>
          </tr>
          <tr>
            <AppTableCell emphasis="primary">Bob Smith</AppTableCell>
            <AppTableCell>bob@example.com</AppTableCell>
            <AppTableCell align="right" emphasis="muted">Pending</AppTableCell>
          </tr>
          <tr>
            <AppTableCell emphasis="primary">Carol White</AppTableCell>
            <AppTableCell>carol@example.com</AppTableCell>
            <AppTableCell align="right" emphasis="muted">Inactive</AppTableCell>
          </tr>
        </AppTableBody>
      </AppTable>
    `,
  }),
};
