import type { Meta, StoryObj } from '@storybook-vue/nuxt';
import AppTable from '~/components/atoms/AppTable.vue';
import AppTableHead from '~/components/atoms/AppTableHead.vue';
import AppTableCell from '~/components/atoms/AppTableCell.vue';

const meta = {
  title: 'Atoms/AppTableHead',
  component: AppTableHead,
  tags: ['autodocs'],
} satisfies Meta<typeof AppTableHead>;

export default meta;
type Story = StoryObj<typeof meta>;

// AppTableHead supplies the `thead` AND the single header `tr`, so its slot takes cells
// directly rather than a row. It is shown inside AppTable because a bare `thead` is not
// valid outside a `table` and browsers relocate it.
export const Default: Story = {
  render: () => ({
    components: { AppTable, AppTableHead, AppTableCell },
    template: `
      <AppTable>
        <AppTableHead>
          <AppTableCell header>Name</AppTableCell>
          <AppTableCell header>Email</AppTableCell>
          <AppTableCell header align="right">Status</AppTableCell>
        </AppTableHead>
      </AppTable>
    `,
  }),
};
