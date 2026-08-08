import { readFileSync } from 'node:fs';
import { ProxyAgent, setGlobalDispatcher } from 'undici';

setGlobalDispatcher(new ProxyAgent('http://127.0.0.1:7890'));

globalThis.ASSETS = {
  async fetch(req) {
    const url = new URL(req.url);
    const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const allowed = ['index.html', 'js/app.js', 'css/style.css', 'vendor/hls.min.js', 'vendor/artplayer.js'];
    if (!allowed.includes(name)) return new Response('Not Found', { status: 404 });
    const body = readFileSync('H:/聚合/app-hub/public/' + name);
    return new Response(body, { status: 200 });
  },
};

const mod = await import('file:///H:/聚合/app-hub/src/worker.js');
const handler = mod.default.fetch;

async function call(path, method = 'GET') {
  const req = new Request('https://app-hub.test-fbc.workers.dev' + path, { method });
  const res = await handler(req, { ASSETS });
  const ct = res.headers.get('content-type') || '';
  const text = await res.text();
  let body = text;
  try { body = ct.includes('json') ? JSON.parse(text) : text; } catch {}
  console.log(path, '->', res.status, ct.includes('json') ? JSON.stringify(body).slice(0, 400) : (String(body).slice(0, 120)));
  return { status: res.status, body, ct };
}

await call('/api/meta');
await call('/api/ja/posts');
await call('/api/18j/posts');
await call('/api/18j/posts?feed=t-13');
await call('/api/18j/posts?page=2');
const jaDetail = await call('/api/ja/post/127930');
const d18 = await call('/api/18j/post/45541');
const jaPlay = await call('/api/ja/play/127930.m3u8');
if (jaPlay.ct.includes('vnd.apple.mpegurl')) {
  const lines = jaPlay.body.split('\n').filter(Boolean);
  console.log('  playlist: extinf lines=', lines.filter(l => l.startsWith('#EXTINF')).length, 'firstSeg=', lines.find(l => !l.startsWith('#')), 'lastSeg=', lines.filter(l => !l.startsWith('#')).pop());
}
