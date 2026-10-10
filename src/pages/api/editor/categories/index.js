// 開發模式專用：列出 src/content/categories 下的 JSON 檔案
import fs from 'fs';
import path from 'path';

const DIR = path.join(process.cwd(), 'src/content/categories');

export function GET() {
  if (!import.meta.env.DEV) {
    return new Response('Only available in dev mode', { status: 404 });
  }

  const files = fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();

  return Response.json({ files });
}
