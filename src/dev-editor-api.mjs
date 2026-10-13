import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API_PATH = '/api/editor/categories';
const IMAGE_API_PATH = '/api/editor/images';
const BODY_LIMIT = 1024 * 1024;
const IMAGE_BODY_LIMIT = 12 * 1024 * 1024; // data URL 為 base64，約可容納 8 MB 圖片
const CATEGORIES_DIR = fileURLToPath(new URL('./content/categories/', import.meta.url));
const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
const IMAGES_SUBDIR = 'images';
const ID_RE = /^[a-zA-Z0-9_-]+$/;
const IMAGE_EXT_BY_MIME = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
};
const KNOWN_IMAGE_EXTS = [...new Set(Object.values(IMAGE_EXT_BY_MIME))];

function isLoopback(address) {
  return (
    address === '127.0.0.1' ||
    address === '::1' ||
    address?.startsWith('::ffff:127.')
  );
}

function send(response, status, body, contentType = 'text/plain; charset=utf-8') {
  response.statusCode = status;
  response.setHeader('Content-Type', contentType);
  response.setHeader('Cache-Control', 'no-store');
  response.end(body);
}

function sendJson(response, status, data) {
  send(
    response,
    status,
    JSON.stringify(data),
    'application/json; charset=utf-8',
  );
}

function safePath(slug) {
  if (!/^[a-zA-Z0-9_-]+\.json$/.test(slug)) return null;
  return path.join(CATEGORIES_DIR, slug);
}

// 解析 data:image/...;base64,xxxx，並用 magic bytes 確認真的是圖片
function parseImageDataUrl(value) {
  const match =
    /^data:(image\/(?:png|jpe?g|gif|webp|avif));base64,([A-Za-z0-9+/=\s]+)$/.exec(
      typeof value === 'string' ? value : '',
    );
  if (!match) return null;

  const mime = match[1] === 'image/jpg' ? 'image/jpeg' : match[1];
  const ext = IMAGE_EXT_BY_MIME[mime];
  if (!ext) return null;

  const buffer = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
  if (!buffer.length || !looksLikeImage(ext, buffer)) return null;
  return { mime, ext, buffer };
}

function looksLikeImage(ext, buffer) {
  const sig = (bytes, offset = 0) =>
    bytes.every((byte, i) => buffer[offset + i] === byte);
  switch (ext) {
    case 'png':
      return sig([0x89, 0x50, 0x4e, 0x47]);
    case 'jpg':
      return sig([0xff, 0xd8, 0xff]);
    case 'gif':
      return buffer.subarray(0, 3).toString('latin1') === 'GIF';
    case 'webp':
      return (
        buffer.subarray(0, 4).toString('latin1') === 'RIFF' &&
        buffer.subarray(8, 12).toString('latin1') === 'WEBP'
      );
    case 'avif':
      return buffer.subarray(4, 8).toString('latin1') === 'ftyp';
    default:
      return false;
  }
}

// public/images/<category>/<product>.<ext>
function imagePaths(category, product) {
  if (!ID_RE.test(category ?? '') || !ID_RE.test(product ?? '')) return null;
  return {
    dir: path.join(PUBLIC_DIR, IMAGES_SUBDIR, category),
    baseName: product,
  };
}

function removeSiblingImages(dir, product) {
  let removed = 0;
  for (const ext of KNOWN_IMAGE_EXTS) {
    const stale = path.join(dir, `${product}.${ext}`);
    if (fs.existsSync(stale)) {
      fs.rmSync(stale);
      removed += 1;
    }
  }
  return removed;
}

async function readBody(request, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) {
      const error = new Error('Request body too large');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readJsonBody(request) {
  return JSON.parse(await readBody(request, BODY_LIMIT));
}

function matchPrefix(pathname, apiPath, normalizedBase) {
  const prefixes = [`${normalizedBase}${apiPath}`, apiPath];
  const prefix = prefixes.find(
    (candidate) => pathname === candidate || pathname.startsWith(candidate + '/'),
  );
  if (!prefix) return null;
  return { prefix, rest: pathname.slice(prefix.length).replace(/^\/+/, '') };
}

async function handleImageRequest(request, response, url) {
  const method = request.method ?? 'GET';

  if (method === 'POST') {
    let body;
    try {
      body = JSON.parse(await readBody(request, IMAGE_BODY_LIMIT));
    } catch (error) {
      sendJson(response, error.status ?? 400, {
        error:
          error.status === 413
            ? '圖片過大（request body 超過上限）'
            : '無效的 JSON request body',
      });
      return;
    }

    const { category, product } = body ?? {};
    if (!ID_RE.test(category ?? '') || !ID_RE.test(product ?? '')) {
      sendJson(response, 400, {
        error: 'category 與 product 只能使用英文、數字、- 或 _，且需先填產品 ID',
      });
      return;
    }

    const image = parseImageDataUrl(body?.dataUrl);
    if (!image) {
      sendJson(response, 400, {
        error: '僅支援 PNG / JPEG / GIF / WEBP / AVIF 的 data URL 圖片',
      });
      return;
    }

    const target = imagePaths(category, product);
    const file = path.join(target.dir, `${product}.${image.ext}`);
    fs.mkdirSync(target.dir, { recursive: true });
    removeSiblingImages(target.dir, product);
    fs.writeFileSync(file, image.buffer);

    const relativePath = `${IMAGES_SUBDIR}/${category}/${product}.${image.ext}`;
    sendJson(response, 201, {
      ok: true,
      path: relativePath,
      bytes: image.buffer.length,
      mime: image.mime,
    });
    return;
  }

  if (method === 'DELETE') {
    const category = url.searchParams.get('category');
    const product = url.searchParams.get('product');
    const target = imagePaths(category, product);
    if (!target) {
      sendJson(response, 400, { error: '無效的 category 或 product' });
      return;
    }
    const removed = fs.existsSync(target.dir)
      ? removeSiblingImages(target.dir, product)
      : 0;
    sendJson(response, 200, { ok: true, removed });
    return;
  }

  response.setHeader('Allow', 'POST, DELETE');
  sendJson(response, 405, { error: 'Method not allowed' });
}

async function handleRequest(request, response, next, base) {
  let url;
  try {
    url = new URL(decodeURIComponent(request.url ?? '/'), 'http://localhost');
  } catch {
    sendJson(response, 400, { error: '無效的網址' });
    return;
  }
  const pathname = url.pathname;
  const normalizedBase = base.replace(/\/+$/, '');

  const categoriesMatch = matchPrefix(pathname, API_PATH, normalizedBase);
  const imagesMatch = categoriesMatch
    ? null
    : matchPrefix(pathname, IMAGE_API_PATH, normalizedBase);

  if (!categoriesMatch && !imagesMatch) {
    next();
    return;
  }

  if (!isLoopback(request.socket.remoteAddress)) {
    sendJson(response, 403, { error: '編輯 API 僅限本機使用' });
    return;
  }

  if (imagesMatch) {
    await handleImageRequest(request, response, url);
    return;
  }

  const slug = categoriesMatch.rest;
  if (!slug) {
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      sendJson(response, 405, { error: 'Method not allowed' });
      return;
    }
    const files = fs
      .readdirSync(CATEGORIES_DIR)
      .filter((file) => file.endsWith('.json'))
      .sort();
    sendJson(response, 200, { files });
    return;
  }

  const file = safePath(slug);
  if (!file) {
    sendJson(response, 400, { error: '無效的檔名' });
    return;
  }
  if (!fs.existsSync(file)) {
    sendJson(response, 404, { error: `找不到檔案：${slug}` });
    return;
  }

  if (request.method === 'GET') {
    send(
      response,
      200,
      fs.readFileSync(file, 'utf8'),
      'application/json; charset=utf-8',
    );
    return;
  }

  if (request.method === 'POST') {
    let body;
    try {
      body = await readJsonBody(request);
    } catch (error) {
      sendJson(response, error.status ?? 400, { error: '無效的 JSON request body' });
      return;
    }

    const content = typeof body?.content === 'string' ? body.content : '';
    let data;
    try {
      data = JSON.parse(content);
    } catch (error) {
      sendJson(response, 400, { error: `JSON 格式錯誤：${error.message}` });
      return;
    }

    fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
    sendJson(response, 200, { ok: true, file: slug });
    return;
  }

  response.setHeader('Allow', 'GET, POST');
  sendJson(response, 405, { error: 'Method not allowed' });
}

export default function devEditorApi() {
  return {
    name: 'local-dev-editor-api',
    hooks: {
      'astro:server:setup': ({ server, logger }) => {
        server.middlewares.use((request, response, next) => {
          handleRequest(request, response, next, server.config.base).catch((error) => {
            logger.error(`Editor API failed: ${error.message}`);
            if (!response.headersSent) {
              sendJson(response, 500, { error: '編輯 API 發生錯誤' });
            } else {
              response.end();
            }
          });
        });
      },
    },
  };
}
