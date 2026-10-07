// API endpoint: 直接輸出 categories JSON
// 開發時編輯 src/content/products.json，build 後自動產生 /api/categories.json

import fs from 'fs';
import path from 'path';

export function GET() {
  const dataPath = path.join(process.cwd(), 'src/content/products.json');
  const raw = fs.readFileSync(dataPath, 'utf-8');
  const data = JSON.parse(raw);

  return new Response(JSON.stringify(data, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=0',
    },
  });
}
