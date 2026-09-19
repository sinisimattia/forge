import type { Meta, StoryObj } from '@storybook-vue/nuxt';
import AppTableRow from '~/components/atoms/AppTableRow.vue';
import AppTable from '~/components/atoms/AppTable.vue';
import AppTableBody from '~/components/atoms/AppTableBody.vue';
import AppTableCell from '~/components/atoms/AppTableCell.vue';

const meta = {
  title: 'Atoms/AppTableRow',
  component: AppTableRow,
  tags: ['autodocs'],
  argTypes: {
    interactive: { control: 'boolean' },
    selected: { control: 'boolean' },
  },
} satisfies Meta<typeof AppTableRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => ({
    components: { AppTableRow, AppTable, AppTableBody, AppTableCell },
    setup: () => ({ args }),
    template: `
      <AppTable>
        <AppTableBody>
          <AppTableRow v-bind="args">
            <AppTableCell emphasis="primary">Alice Johnson</AppTableCell>
            <AppTableCell>alice@example.com</AppTableCell>
            <AppTableCell align="right" emphasis="muted">Active</AppTableCell>
          </AppTableRow>
        </AppTableBody>
      </AppTable>
    `,
  }),
  args: { interactive: false, selected: false },
};

export const Interactive: Story = {
  render: (args) => ({
    components: { AppTableRow, AppTable, AppTableBody, AppTableCell },
    setup: () => ({ args }),
    template: `
      <AppTable>
        <AppTableBody>
          <AppTableRow v-bind="args">
            <AppTableCell emphasis="primary">Bob Smith</AppTableCell>
            <AppTableCell>bob@example.com</AppTableCell>
            <AppTableCell align="right" emphasis="muted">Pending</AppTableCell>
          </AppTableRow>
        </AppTableBody>
      </AppTable>
    `,
  }),
  args: { interactive: true, selected: false },
};

export const Selected: Story = {
  render: (args) => ({
    components: { AppTableRow, AppTable, AppTableBody, AppTableCell },
    setup: () => ({ args }),
    template: `
      <AppTable>
        <AppTableBody>
          <AppTableRow v-bind="args">
            <AppTableCell emphasis="primary">Carol White</AppTableCell>
            <AppTableCell>carol@example.com</AppTableCell>
            <AppTableCell align="right" emphasis="muted">Inactive</AppTableCell>
          </AppTableRow>
        </AppTableBody>
      </AppTable>
    `,
  }),
  args: { interactive: false, selected: true },
};

export const InteractiveSelected: Story = {
  render: (args) => ({
    components: { AppTableRow, AppTable, AppTableBody, AppTableCell },
    setup: () => ({ args }),
    template: `
      <AppTable>
        <AppTableBody>
          <AppTableRow v-bind="args">
            <AppTableCell emphasis="primary">Dana Lee</AppTableCell>
            <AppTableCell>dana@example.com</AppTableCell>
            <AppTableCell align="right" emphasis="muted">Active</AppTableCell>
          </AppTableRow>
        </AppTableBody>
      </AppTable>
    `,
  }),
  args: { interactive: true, selected: true },
};

export const MultipleRows: Story = {
  render: () => ({
    components: { AppTableRow, AppTable, AppTableBody, AppTableCell },
    template: `
      <AppTable>
        <AppTableBody>
          <AppTableRow>
            <AppTableCell emphasis="primary">Default row</AppTableCell>
            <AppTableCell>No hover effect</AppTableCell>
          </AppTableRow>
          <AppTableRow :interactive="true">
            <AppTableCell emphasis="primary">Interactive row</AppTableCell>
            <AppTableCell>Hover to see highlight</AppTableCell>
          </AppTableRow>
          <AppTableRow :selected="true">
            <AppTableCell emphasis="primary">Selected row</AppTableCell>
            <AppTableCell>Persistently highlighted</AppTableCell>
          </AppTableRow>
          <AppTableRow :interactive="true" :selected="true">
            <AppTableCell emphasis="primary">Interactive + selected</AppTableCell>
            <AppTableCell>Both states active</AppTableCell>
          </AppTableRow>
        </AppTableBody>
      </AppTable>
    `,
  }),
};
