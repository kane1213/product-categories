import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API_PATH = '/api/editor/categories';
const BODY_LIMIT = 1024 * 1024;
const CATEGORIES_DIR = fileURLToPath(new URL('./content/categories/', import.meta.url));

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

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > BODY_LIMIT) {
      const error = new Error('Request body too large');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function handleRequest(request, response, next, base) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
  } catch {
    sendJson(response, 400, { error: '無效的網址' });
    return;
  }

  const normalizedBase = base.replace(/\/+$/, '');
  const prefixes = [`${normalizedBase}${API_PATH}`, API_PATH];
  const prefix = prefixes.find(
    (candidate) => pathname === candidate || pathname.startsWith(candidate + '/'),
  );
  if (!prefix) {
    next();
    return;
  }

  if (!isLoopback(request.socket.remoteAddress)) {
    sendJson(response, 403, { error: '編輯 API 僅限本機使用' });
    return;
  }

  const slug = pathname === prefix ? null : pathname.slice(prefix.length + 1);
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
