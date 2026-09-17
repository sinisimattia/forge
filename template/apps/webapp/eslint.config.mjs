// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs';
import storybook from 'eslint-plugin-storybook';
import houseStyle from '../../eslint.config.base.mjs';

// Shared house style is applied last so it wins over Nuxt/Storybook defaults.
// Prettier (and eslint-config-prettier) are not used — ESLint owns formatting.
export default withNuxt(...storybook.configs['flat/recommended'], ...houseStyle);
