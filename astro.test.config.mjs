// 僅供測試用：與正式 config 相同，但忽略 .env 的 watch（sandbox 下 .env 是裝置檔會觸發無限重啟）
import { defineConfig } from 'astro/config';

export default defineConfig({
  base: '/product-categories',
  vite: {
    server: {
      watch: { ignored: ['**/.env'] },
    },
  },
});
