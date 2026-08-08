'use strict';

const UPSTREAM = 'https://tangxinvlog.pro';
const CDN = 'https://t.5gcdn.xyz';
const SLUG_RE = /^[0-9a-f]{10}$/;
const SEG_RE = /^[A-Za-z0-9_.-]+$/;

function clean(s) {
  return String(s ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseCards(html) {
  const out = [];
  const seen = new Set();
  const cardRe = /<a class="video-card" href="\/videos\/([0-9a-f]{10})\/">([\s\S]*?)<\/a>/g;
  let m;
  while ((m = cardRe.exec(html))) {
    const id = m[1];
    if (seen.has(id)) continue;
    const block = m[2];
    const img = block.match(/<img src="(https:\/\/[^"]+)" alt="([^"]*)"/);
    const title = img ? clean(img[2]) : (block.match(/<h3 class="title">([\s\S]*?)<\/h3>/) || [])[1];
    if (!title) continue;
    const durationM = block.match(/class="duration">([^<]+)</);
    const authorM = block.match(/<div class="meta">\s*<span>([\s\S]*?)<\/span>/);
    const vidM = (img && img[1].match(/\/videos\/(\d+)\//)) || [];
    seen.add(id);
    out.push({
      id,
      title: clean(title),
      duration: durationM ? durationM[1].trim() : null,
      author: authorM ? clean(authorM[1]) : null,
      coverUrl: vidM[1] ? `/api/tx/image?vid=${encodeURIComponent(vidM[1])}` : null,
    });
  }
  return out;
}

async function posts(site, url, h) {
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const cat = (url.searchParams.get('feed') || '').trim();
  const feed = site.feeds.find((f) => f.id === cat) || site.feeds[0];
  const upstream = feed && feed.isHome ? `${UPSTREAM}/` : page > 1 ? `${UPSTREAM}/videos/${page}/` : `${UPSTREAM}/videos/`;
  const html = await h.upstream(site, upstream, { referer: UPSTREAM + '/' });
  const list = parseCards(html);
  const hasNext = feed && feed.isHome ? false : new RegExp(`href="/videos/${page + 1}/"`).test(html);
  return h.json({ ok: true, page, hasNext, totalPages: null, posts: list });
}

async function post(site, url, h) {
  const segments = url.pathname.split('/').filter(Boolean);
  const id = decodeURIComponent(segments[segments.length - 1] || '');
  if (!SLUG_RE.test(id)) return h.json({ ok: false, error: '视频 ID 无效' }, 400);
  const html = await h.upstream(site, `${UPSTREAM}/videos/${id}/`, { referer: UPSTREAM + '/' });
  const h1 = html.match(/<h1>([\s\S]*?)<\/h1>/);
  const title = h1 ? clean(h1[1]) : '';
  if (!title) return h.json({ ok: false, error: '内容不存在' }, 404);
  const srcM = html.match(/<video[^>]*(?:data-src|src)="(https:\/\/[^"]+?\.m3u8[^"]*)"/);
  const posterM = html.match(/poster="(https:\/\/[^"]+)"/);
  const dateM = html.match(/<div class="row">[\s\S]*?<span>(\d{4}-\d{2}-\d{2})<\/span>/);
  const durationM = html.match(/<div class="row">[\s\S]*?<span>\d{4}-\d{2}-\d{2}<\/span>\s*<span>([^<]+)<\/span>/);
  const authorM = html.match(/<div class="row">\s*<a href="\/artists\/[^"]*">([\s\S]*?)<\/a>/);
  const descM = html.match(/<div class="video-desc">([\s\S]*?)<\/div>/);
  const tags = [...html.matchAll(/<span class="tag">([\s\S]*?)<\/span>/g)].map((x) => clean(x[1])).filter(Boolean);
  const vidM = (srcM && srcM[1].match(/\/videos\/(\d+)\//)) || [];
  const posterVid = (posterM && posterM[1].match(/\/videos\/(\d+)\//)) || [];
  const related = parseCards(html).filter((r) => r.id !== id).slice(0, 12);
  return h.json({
    ok: true,
    post: {
      id,
      title,
      description: descM ? clean(descM[1]) : '',
      author: authorM ? clean(authorM[1]) : null,
      dateText: dateM ? dateM[1] : null,
      duration: durationM ? durationM[1].trim() : null,
      coverUrl: posterVid[1] ? `/api/tx/image?vid=${encodeURIComponent(posterVid[1])}` : null,
      tags,
      playUrl: vidM[1] ? `/api/tx/play?vid=${vidM[1]}` : null,
      related,
    },
  }, 200, 'no-store');
}

async function image(site, url, h) {
  const vid = url.searchParams.get('vid') || '';
  if (!/^\d+$/.test(vid)) return new Response('bad vid', { status: 400 });
  const res = await fetch(`${CDN}/videos/${vid}/cover.jpg`, {
    headers: {
      'User-Agent': h.ua,
      Referer: UPSTREAM + '/',
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    },
  });
  if (!res.ok) return new Response('upstream ' + res.status, { status: res.status });
  const responseHeaders = new Headers(res.headers);
  responseHeaders.set('Content-Type', res.headers.get('Content-Type') || 'image/jpeg');
  responseHeaders.set('Cache-Control', 'public, max-age=86400');
  responseHeaders.set('Access-Control-Allow-Origin', '*');
  responseHeaders.delete('Set-Cookie');
  return new Response(res.body, {
    status: res.status,
    headers: responseHeaders,
  });
}

async function play(site, url, h) {
  const vid = url.searchParams.get('vid') || '';
  const seg = url.searchParams.get('seg') || '';
  if (!/^\d+$/.test(vid)) return h.json({ ok: false, error: '视频 ID 无效' }, 400);
  const base = `${CDN}/videos/${vid}/`;
  const referer = UPSTREAM + '/';
  if (seg) {
    if (!SEG_RE.test(seg)) return new Response('bad seg', { status: 400 });
    const res = await fetch(base + seg, {
      headers: { 'User-Agent': h.ua, Referer: referer },
    });
    if (!res.ok) return new Response('upstream ' + res.status, { status: 502 });
    const isKey = /\.key$/.test(seg);
    return new Response(res.body, {
      status: 200,
      headers: {
        'Content-Type': isKey ? 'application/octet-stream' : 'video/mp2t',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=60',
        'Content-Length': res.headers.get('Content-Length') || undefined,
      },
    });
  }
  const text = await h.upstream(site, base + 'index.m3u8', { referer, allowHtml: true });
  const proxyBase = `/api/tx/play?vid=${vid}&seg=`;
  const rewritten = text
    .replace(/^(#EXT-X-KEY:[^"\n]*?URI=")([^"]+)(.*)$/gm, (all, prefix, file, rest) => {
      if (/^https?:\/\//.test(file)) return all;
      return `${prefix}${proxyBase}${file}${rest}`;
    })
    .replace(/^(?!#)([A-Za-z0-9_.-]+\.ts)$/gm, (all, file) => proxyBase + file);
  return new Response(rewritten, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-mpegURL',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=30',
    },
  });
}

export { posts, post, image, play };
