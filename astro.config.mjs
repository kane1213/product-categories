import { defineConfig } from 'astro/config';
import devEditorApi from './src/dev-editor-api.mjs';

export default defineConfig({
  base: '/product-categories',
  integrations: [devEditorApi()],
});
