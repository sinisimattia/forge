import type { Meta, StoryObj } from '@storybook-vue/nuxt';
import AppImage from '~/components/atoms/AppImage.vue';

const placeholderSrc = 'https://placehold.co/400x300';

const meta = {
  title: 'Atoms/AppImage',
  component: AppImage,
  tags: ['autodocs'],
  argTypes: {
    size: {
      control: 'select',
      options: ['sm', 'md', 'lg', 'auto'],
    },
    rounded: {
      control: 'select',
      options: ['none', 'md', 'lg', 'full'],
    },
    fit: {
      control: 'select',
      options: ['contain', 'cover', 'fill'],
    },
    src: { control: 'text' },
    alt: { control: 'text' },
    maxWidth: { control: 'text' },
  },
} satisfies Meta<typeof AppImage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { src: placeholderSrc, alt: 'Placeholder image', maxWidth: '400px' },
};

export const Small: Story = {
  args: { src: placeholderSrc, alt: 'Small image', size: 'sm' },
};

export const Medium: Story = {
  args: { src: placeholderSrc, alt: 'Medium image', size: 'md' },
};

export const Large: Story = {
  args: { src: placeholderSrc, alt: 'Large image', size: 'lg' },
};

export const RoundedFull: Story = {
  args: { src: placeholderSrc, alt: 'Avatar', size: 'md', rounded: 'full' },
};

export const RoundedLg: Story = {
  args: { src: placeholderSrc, alt: 'Rounded image', size: 'lg', rounded: 'lg' },
};
