import type { Meta, StoryObj } from '@storybook-vue/nuxt';
import TotpEnrollment from '~/components/organisms/TotpEnrollment.vue';

/**
 * A QR of no real secret: the squares below encode nothing, and the secret is the
 * base32 of the ASCII digits `1234567890`, a value nobody has been given by a
 * server.
 */
const QR = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" shape-rendering="crispEdges">'
  + '<path d="M0 0h3v3H0zM5 0h3v3H5zM0 5h3v3H0zM4 4h1v1H4zM6 6h2v2H6z"/></svg>';

const BASE32_SEED = 'GEZDGNBVGY3TQOJQ';

const meta = {
  title: 'Organisms/TotpEnrollment',
  component: TotpEnrollment,
  tags: ['autodocs'],
  argTypes: { busy: { control: 'boolean' }, wrongCode: { control: 'boolean' } },
  parameters: { layout: 'centered' },
} satisfies Meta<typeof TotpEnrollment>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    offer: {
      methodId: 'method-1',
      otpauthUri: `otpauth://totp/Example:ada%40example.test?secret=${BASE32_SEED}&issuer=Example`,
      qrSvg: QR,
      secret: BASE32_SEED,
    },
  },
};

export const WrongCode: Story = {
  args: { ...Default.args, wrongCode: true },
};

export const Busy: Story = {
  args: { ...Default.args, busy: true },
};
