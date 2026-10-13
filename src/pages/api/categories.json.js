// API endpoint：掃描 src/content/categories/*.json，合成 categories 陣列輸出
// build 時預渲染成靜態 JSON，部署後也可用

import fs from 'fs';
import path from 'path';

export const prerender = true;

export function GET() {
  const dir = path.join(process.cwd(), 'src/content/categories');
  const categories = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')))
    .map((category) => ({
      ...category,
      // 輸出固定帶 img_url（舊資料沒有此欄位時補空字串），讓前端 schema 一致
      products: (category.products ?? []).map(({ img_url = '', ...rest }) => ({
        ...rest,
        img_url,
      })),
    }))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id));

  return new Response(JSON.stringify({ categories }, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=0',
    },
  });
}
