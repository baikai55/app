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

const TEST_ENV = {
  ASSETS,
  HJ_TOKEN: process.env.HJ_TOKEN || '',
  HJ_UID: process.env.HJ_UID || '',
};

async function call(path, method = 'GET') {
  const req = new Request('https://app-hub.test-fbc.workers.dev' + path, { method });
  const res = await handler(req, TEST_ENV);
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
await call('/api/kan91/posts');
await call('/api/mr/posts');
await call('/api/tx/posts');
await call('/api/rou/posts');
await call('/api/best/posts');
await call('/api/madouai/posts');
await call('/api/madou/posts');
await call('/api/madou/posts?feed=麻豆传媒');
const k91 = await call('/api/kan91/post/387986');
const mrD = await call('/api/mr/post/187506');
const txD = await call('/api/tx/post/9ffe9878ee');
const rouD = await call('/api/rou/post/cmsj6kyo10000s63fmh6xdhmy');
const mdD = await call('/api/madouai/post/16950');
const mD = await call('/api/madou/post/巨乳痴女主观镜头-淫语射精joi.html');
console.log('kan91 playUrl:', k91.body?.post?.playUrl);
console.log('mr playUrl:', mrD.body?.post?.videos?.[0]?.playUrl);
console.log('tx playUrl:', txD.body?.post?.playUrl);
console.log('rou playUrl:', rouD.body?.post?.playUrl);
console.log('madouai playUrl:', mdD.body?.post?.playUrl);
console.log('madou playUrl:', mD.body?.post?.playUrl);
const k91p = await call('/api/kan91/play?id=387986');
const mrP = await call('/api/mr/play?url=' + encodeURIComponent(mrD.body.post.videos[0].playUrl));
const txP = await call('/api/tx/play?vid=35016');
const rouP = await call('/api/rou/play?id=cmsj6kyo10000s63fmh6xdhmy');
const mdP = await call('/api/madouai/play?path=' + encodeURIComponent('jpd/20251217/4t/lo/4w/kx/f9ffdeb803f24ea0844b053c02b2bb94.m3u8'));
const mP = await call('/api/madou/play?id=68ff2021d2f708714780a8c1');
for (const [name, res] of [['kan91', k91p], ['mr', mrP], ['tx', txP], ['rou', rouP], ['madouai', mdP], ['madou', mP]]) {
  const text = res.body;
  const lines = String(text).split('\n');
  console.log(name, 'playlist extinf:', lines.filter(l => l.startsWith('#EXTINF')).length, 'firstSeg:', lines.find(l => !l.startsWith('#')), 'keyLine:', lines.find(l => l.startsWith('#EXT-X-KEY')));
}

// image cover checks
console.log('--- cover urls ---');
console.log('kan91 cover:', k91.body?.post?.posts?.length ? '(list)' : '', k91.body?.post?.coverUrl);
const k91List = (await call('/api/kan91/posts')).body;
console.log('kan91 list cover0:', k91List.posts?.[0]?.coverUrl);
const mrList = (await call('/api/mr/posts')).body;
console.log('mr list cover0:', mrList.posts?.[0]?.coverUrl);
const txList = (await call('/api/tx/posts')).body;
console.log('tx list cover0:', txList.posts?.[0]?.coverUrl);
const mdList = (await call('/api/madouai/posts')).body;
console.log('madouai list cover0:', mdList.posts?.[0]?.coverUrl);

async function imgProbe(url) {
  const req = new Request(url, { method: 'GET' });
  const res = await handler(req, TEST_ENV);
  const bytes = new Uint8Array(await res.arrayBuffer());
  console.log(url.split('?')[0], '->', res.status, res.headers.get('content-type'), 'len:', bytes.length);
}
if (k91List.posts?.[0]?.coverUrl) await imgProbe('https://app-hub.test-fbc.workers.dev' + k91List.posts[0].coverUrl);
if (mrList.posts?.[0]?.coverUrl) await imgProbe('https://app-hub.test-fbc.workers.dev' + mrList.posts[0].coverUrl);
if (txList.posts?.[0]?.coverUrl) await imgProbe('https://app-hub.test-fbc.workers.dev' + txList.posts[0].coverUrl);
if (mdList.posts?.[0]?.coverUrl) await imgProbe('https://app-hub.test-fbc.workers.dev' + mdList.posts[0].coverUrl);

// hj site checks
console.log('--- hj ---');
const hjList = await call('/api/hj/posts');
const hjListHot = await call('/api/hj/posts?feed=hot');
const hjListNews = await call('/api/hj/posts?feed=news');
console.log('hj posts count:', hjList.body?.posts?.length, 'first:', JSON.stringify(hjList.body?.posts?.[0]?.title)?.slice(0, 60), 'cover:', hjList.body?.posts?.[0]?.coverUrl?.slice(0, 80));
const firstHj = hjList.body?.posts?.[0];
if (firstHj) {
  const hjDetail = await call('/api/hj/post/' + encodeURIComponent(firstHj.id));
  console.log('hj detail title:', hjDetail.body?.post?.title?.slice(0, 60), 'playUrl:', hjDetail.body?.post?.playUrl, 'videos:', hjDetail.body?.post?.videos?.length, 'cover:', hjDetail.body?.post?.coverUrl?.slice(0, 80));
  if (hjDetail.body?.post?.coverUrl) await imgProbe('https://app-hub.test-fbc.workers.dev' + hjDetail.body.post.coverUrl);
  if (hjDetail.body?.post?.playUrl) {
    const hjP = await call(hjDetail.body.post.playUrl.replace('/api/hj/', '/api/hj/'));
    const hjText = hjP.body;
    const hjLines = String(hjText).split('\n');
    console.log('hj playlist extinf:', hjLines.filter(l => l.startsWith('#EXTINF')).length, 'firstSeg:', hjLines.find(l => !l.startsWith('#')), 'keyLine:', hjLines.find(l => l.startsWith('#EXT-X-KEY')));
  }
}
