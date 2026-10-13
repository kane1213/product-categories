import { defineConfig } from 'astro/config';
import devEditorApi from './src/dev-editor-api.mjs';

export default defineConfig({
  base: '/product-categories',
  integrations: [devEditorApi()],
  // .env 在這個環境是裝置檔（無法讀取內容），不忽略的話 Vite 會無限偵測到「變更」而不斷重啟 dev server
  vite: {
    server: {
      watch: {
        ignored: ['**/.env'],
      },
    },
  },
});
