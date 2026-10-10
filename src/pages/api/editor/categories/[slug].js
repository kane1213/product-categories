// 開發模式專用：讀取 / 覆寫 src/content/categories/<slug>.json
import fs from 'fs';
import path from 'path';

// 動態路由需關掉預渲染，否則 Astro 會要求 getStaticPaths 並回 500
export const prerender = false;

const DIR = path.join(process.cwd(), 'src/content/categories');

function safePath(slug) {
  if (!/^[a-zA-Z0-9_-]+\.json$/.test(slug)) return null;
  const file = path.join(DIR, path.basename(slug));
  // 雙重保險：確保寫入的檔案仍在 categories 目錄內
  return file.startsWith(DIR + path.sep) ? file : null;
}

export function GET({ params }) {
  if (!import.meta.env.DEV) {
    return new Response('Only available in dev mode', { status: 404 });
  }

  const file = safePath(params.slug);
  if (!file || !fs.existsSync(file)) {
    return Response.json({ error: `找不到檔案：${params.slug}` }, { status: 404 });
  }

  return new Response(fs.readFileSync(file, 'utf-8'), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

export async function POST({ params, request }) {
  if (!import.meta.env.DEV) {
    return new Response('Only available in dev mode', { status: 404 });
  }

  const file = safePath(params.slug);
  if (!file) {
    return Response.json({ error: '無效的檔名' }, { status: 400 });
  }
  if (!fs.existsSync(file)) {
    return Response.json({ error: `找不到檔案：${params.slug}` }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const content = typeof body?.content === 'string' ? body.content : '';

  let data;
  try {
    data = JSON.parse(content);
  } catch (err) {
    return Response.json(
      { error: `JSON 格式錯誤：${err.message}` },
      { status: 400 },
    );
  }

  // 以 2 空格縮排覆寫原檔，並補上結尾換行
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf-8');

  return Response.json({ ok: true, file: params.slug });
}
