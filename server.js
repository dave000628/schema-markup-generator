/* =========================================================================
   server.js — tiny zero-dependency backend for the Schema Markup Generator.
   Crawls submitted URLs, auto-generates JSON-LD, and serves the review UI.

     GET  /                 -> public/index.html (crawler + review interface)
     GET  /manual.html      -> public/manual.html (manual field editor, bonus)
     POST /api/generate     -> { results: [...] }   body: { urls[], typeOverride?, includeBreadcrumb? }

   Run:  node server.js   (Node 18+, no npm install needed)
   ========================================================================= */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { generateForPage } from './src/extract.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const MAX_URLS = 50;
const CONCURRENCY = 5;
const FETCH_TIMEOUT = 12000;
const MAX_BYTES = 3_000_000;

/* Respect an outbound proxy if one is configured (e.g. sandboxed environments).
   No-op on a normal machine. Best-effort: ignored if undici isn't importable. */
try {
  if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY) {
    const { EnvHttpProxyAgent, setGlobalDispatcher } = await import('undici');
    setGlobalDispatcher(new EnvHttpProxyAgent());
  }
} catch { /* plain fetch is fine on a user's machine */ }

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml' };

async function fetchHtml(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(url, {
      redirect: 'follow', signal: ctrl.signal,
      headers: { 'user-agent': 'SchemaMarkupGenerator/1.0 (+https://schema.org)', 'accept': 'text/html,*/*' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const ct = res.headers.get('content-type') || '';
    if (!/html|xml|text/.test(ct)) throw new Error(`Not an HTML page (content-type: ${ct || 'unknown'})`);
    // read with a size cap
    const reader = res.body.getReader();
    let received = 0; const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length; chunks.push(value);
      if (received > MAX_BYTES) { ctrl.abort(); break; }
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally { clearTimeout(timer); }
}

function normalizeUrl(u) {
  u = u.trim();
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  try { return new URL(u).href; } catch { return null; }
}

async function generateOne(rawUrl, opts) {
  const url = normalizeUrl(rawUrl);
  if (!url) return { url: rawUrl, error: 'Invalid URL' };
  try {
    const html = await fetchHtml(url);
    return generateForPage(html, url, opts);
  } catch (e) {
    return { url, error: e.name === 'AbortError' ? 'Timed out or too large' : e.message };
  }
}

async function runBatch(urls, opts) {
  const results = new Array(urls.length);
  let idx = 0;
  async function worker() {
    while (idx < urls.length) {
      const i = idx++;
      results[i] = await generateOne(urls[i], opts);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, urls.length) }, worker));
  return results;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''; req.on('data', c => { data += c; if (data.length > 100_000) req.destroy(); });
    req.on('end', () => resolve(data)); req.on('error', reject);
  });
}
function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/api/generate') {
      const body = JSON.parse(await readBody(req) || '{}');
      let urls = Array.isArray(body.urls) ? body.urls : [];
      urls = urls.map(String).filter(s => s.trim()).slice(0, MAX_URLS);
      if (!urls.length) return send(res, 400, JSON.stringify({ error: 'No URLs provided' }));
      const opts = { typeOverride: body.typeOverride || null, includeBreadcrumb: body.includeBreadcrumb !== false };
      const results = await runBatch(urls, opts);
      return send(res, 200, JSON.stringify({ results }));
    }

    // static files
    let path = req.url.split('?')[0];
    if (path === '/') path = '/index.html';
    if (path === '/manual') path = '/manual.html';
    const file = join(__dirname, 'public', path.replace(/\.\./g, ''));
    try {
      const buf = await readFile(file);
      return send(res, 200, buf, MIME[extname(file)] || 'application/octet-stream');
    } catch {
      return send(res, 404, 'Not found', 'text/plain');
    }
  } catch (e) {
    send(res, 500, JSON.stringify({ error: e.message }));
  }
});

server.listen(PORT, () => console.log(`Schema Markup Generator running at http://localhost:${PORT}`));
