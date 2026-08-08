'use strict';

const UPSTREAM = 'https://rou.video';

function clean(s) {
  return String(s ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function nextData(html) {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    const root = JSON.parse(m[1]);
    return root && root.props && root.props.pageProps ? root.props.pageProps : null;
  } catch {
    return null;
  }
}

function durationText(seconds) {
  if (typeof seconds !== 'number' || !isFinite(seconds) || seconds < 0) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function videoSummary(item) {
  const id = typeof item.id === 'string' && /^[A-Za-z0-9_-]+$/.test(item.id) ? item.id : null;
  if (!id) return null;
  const title = clean(item.nameZh || item.name || item.title || '');
  if (!title) return null;
  const cover = typeof item.coverImageUrl === 'string' ? item.coverImageUrl : null;
  return {
    id,
    title,
    duration: durationText(item.duration),
    coverUrl: cover,
    views: typeof item.viewCount === 'number' ? item.viewCount : null,
  };
}

function parseCards(html, isHome) {
  const pp = nextData(html);
  if (!pp) return [];
  const out = [];
  const seen = new Set();
  let arrays;
  if (Array.isArray(pp.videos) && pp.videos.length) {
    arrays = [pp.videos];
  } else if (isHome) {
    arrays = [
      'latestVideos', 'dailyHotCNAV', 'dailyHotSelfie', 'dailyHot91',
      'dailyOnlyFans', 'dailyJV', 'hotCNAV', 'hotSelfie', 'hot91',
    ]
      .map((k) => pp[k])
      .filter((a) => Array.isArray(a) && a.length);
  } else {
    arrays = [];
    for (const k of Object.keys(pp)) {
      const a = pp[k];
      if (Array.isArray(a) && a.length && a[0] && typeof a[0] === 'object' && 'coverImageUrl' in a[0]) {
        arrays.push(a);
      }
    }
  }
  for (const arr of arrays) {
    for (const item of arr) {
      const v = videoSummary(item);
      if (!v || seen.has(v.id)) continue;
      seen.add(v.id);
      out.push(v);
    }
  }
  return out;
}

function parsePager(html) {
  const pp = nextData(html);
  if (!pp) return { page: 1, totalPages: 1 };
  const pageNum = Number(pp.pageNum) || 1;
  const totalPage = Number(pp.totalPage) || 0;
  return { page: pageNum, totalPages: totalPage >= pageNum ? totalPage : pageNum };
}

function decodeVideoUrl(ev) {
  if (!ev || typeof ev.d !== 'string' || typeof ev.k !== 'number') return null;
  const bin = atob(ev.d);
  let out = '';
  for (let i = 0; i < bin.length; i++) {
    out += String.fromCharCode((bin.charCodeAt(i) - ev.k) & 0xff);
  }
  try {
    const obj = JSON.parse(out);
    const url = typeof obj.videoUrl === 'string' ? obj.videoUrl : null;
    return /^https:\/\//.test(url || '') ? url : null;
  } catch {
    return null;
  }
}

function parseDetail(html, id) {
  const pp = nextData(html);
  if (!pp || !pp.video) return null;
  const v = pp.video;
  const videoId = typeof v.id === 'string' && /^[A-Za-z0-9_-]+$/.test(v.id) ? v.id : null;
  if (!videoId) return null;
  const title = clean(v.nameZh || v.name || '');
  const tags = Array.isArray(v.tagsZh) ? v.tagsZh.map((t) => String(t)).filter(Boolean)
    : Array.isArray(v.tags) ? v.tags.map((t) => String(t)).filter(Boolean)
    : [];
  const related = Array.isArray(pp.relatedVideos) ? pp.relatedVideos.map((r) => videoSummary(r)).filter(Boolean) : [];
  return {
    id: videoId,
    title,
    description: clean(v.description || ''),
    author: typeof v.publisher === 'string' ? v.publisher : null,
    dateText: typeof v.createdAt === 'string' ? v.createdAt.slice(0, 10) : null,
    views: typeof v.viewCount === 'number' ? v.viewCount : null,
    duration: durationText(v.duration),
    coverUrl: typeof v.coverImageUrl === 'string' ? v.coverImageUrl : null,
    tags,
    playUrl: decodeVideoUrl(pp.ev) ? `/api/rou/play?id=${videoId}` : null,
    related,
  };
}

async function posts(site, url, h) {
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const cat = (url.searchParams.get('feed') || '').trim();
  const feed = site.feeds.find((f) => f.id === cat) || site.feeds[0];
  const isHome = !!feed && feed.isHome;
  const upstream = isHome ? UPSTREAM + feed.path : `${UPSTREAM}${feed.path}?page=${page}`;
  const html = await h.upstream(site, upstream, { referer: UPSTREAM + '/' });
  const list = parseCards(html, isHome);
  const { totalPages } = parsePager(html);
  return h.json({ ok: true, page: isHome ? 1 : page, totalPages, posts: list });
}

async function post(site, url, h) {
  const segments = url.pathname.split('/').filter(Boolean);
  const id = decodeURIComponent(segments[segments.length - 1] || '');
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return h.json({ ok: false, error: '视频 ID 无效' }, 400);
  const html = await h.upstream(site, `${UPSTREAM}/v/${id}`, { referer: UPSTREAM + '/' });
  const detail = parseDetail(html, id);
  if (!detail) return h.json({ ok: false, error: '内容不存在' }, 404);
  return h.json({ ok: true, post: detail }, 200, 'no-store');
}

async function play(site, url, h) {
  const id = url.searchParams.get('id') || '';
  const ts = url.searchParams.get('ts') || '';
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return h.json({ ok: false, error: '视频 ID 无效' }, 400);
  if (ts) {
    const decoded = decodeURIComponent(ts);
    if (!/^https:\/\/v\.rn\d+\.xyz\//.test(decoded)) return new Response('bad ts', { status: 400 });
    const res = await fetch(decoded, {
      headers: { 'User-Agent': h.ua, Referer: UPSTREAM + '/' },
    });
    if (!res.ok) return new Response('upstream ' + res.status, { status: 502 });
    return new Response(res.body, {
      status: 200,
      headers: {
        'Content-Type': 'video/mp2t',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=60',
        'Content-Length': res.headers.get('Content-Length') || undefined,
      },
    });
  }
  const html = await h.upstream(site, `${UPSTREAM}/v/${id}`, { referer: UPSTREAM + '/' });
  const pp = nextData(html);
  const ev = pp && pp.ev ? pp.ev : null;
  const videoUrl = decodeVideoUrl(ev);
  if (!videoUrl) return new Response('no playable source', { status: 404 });
  const res = await fetch(videoUrl, {
    headers: { 'User-Agent': h.ua, Referer: UPSTREAM + '/' },
  });
  if (!res.ok) return new Response('upstream ' + res.status, { status: 502 });
  const text = await res.text();
  const proxyBase = `/api/rou/play?id=${id}&ts=`;
  const rewritten = text.replace(/^(https:\/\/[^\s]+)$/gm, (match) => proxyBase + encodeURIComponent(match));
  return new Response(rewritten, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-mpegURL',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=30',
    },
  });
}

export { posts, post, play };
