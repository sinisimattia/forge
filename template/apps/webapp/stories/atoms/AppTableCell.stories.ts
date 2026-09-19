import type { Meta, StoryObj } from '@storybook-vue/nuxt';
import AppTable from '~/components/atoms/AppTable.vue';
import AppTableBody from '~/components/atoms/AppTableBody.vue';
import AppTableRow from '~/components/atoms/AppTableRow.vue';
import AppTableCell from '~/components/atoms/AppTableCell.vue';

const meta = {
  title: 'Atoms/AppTableCell',
  component: AppTableCell,
  tags: ['autodocs'],
  argTypes: {
    header: { control: 'boolean' },
    align: { control: 'select', options: ['left', 'right'] },
    emphasis: { control: 'select', options: ['primary', 'secondary', 'muted'] },
    nowrap: { control: 'boolean' },
    colspan: { control: 'number' },
  },
} satisfies Meta<typeof AppTableCell>;

export default meta;
type Story = StoryObj<typeof meta>;

// `header` switches the rendered element between `th` and `td`, so every story here wraps
// the cell in a real table — the two are not interchangeable outside one.
export const EveryEmphasis: Story = {
  render: () => ({
    components: { AppTable, AppTableBody, AppTableRow, AppTableCell },
    template: `
      <AppTable>
        <AppTableBody>
          <AppTableRow>
            <AppTableCell emphasis="primary">Primary</AppTableCell>
            <AppTableCell emphasis="secondary">Secondary</AppTableCell>
            <AppTableCell emphasis="muted">Muted</AppTableCell>
          </AppTableRow>
        </AppTableBody>
      </AppTable>
    `,
  }),
};

export const AsHeader: Story = {
  render: () => ({
    components: { AppTable, AppTableBody, AppTableRow, AppTableCell },
    template: `
      <AppTable>
        <AppTableBody>
          <AppTableRow>
            <AppTableCell header>Name</AppTableCell>
            <AppTableCell header align="right">Amount</AppTableCell>
          </AppTableRow>
        </AppTableBody>
      </AppTable>
    `,
  }),
};

export const RightAlignedAndSpanning: Story = {
  render: () => ({
    components: { AppTable, AppTableBody, AppTableRow, AppTableCell },
    template: `
      <AppTable>
        <AppTableBody>
          <AppTableRow>
            <AppTableCell>Subtotal</AppTableCell>
            <AppTableCell align="right" emphasis="primary">1,204</AppTableCell>
          </AppTableRow>
          <AppTableRow>
            <AppTableCell :colspan="2" emphasis="muted">Spans both columns</AppTableCell>
          </AppTableRow>
        </AppTableBody>
      </AppTable>
    `,
  }),
};
