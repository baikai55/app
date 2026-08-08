'use strict';

const UPSTREAM = 'https://madou.casa';
const DASH = 'https://dash.madou.casa';

function clean(s) {
  return String(s ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function parseItems(html) {
  const items = [];
  const re = /<article class="madou_casa-excerpt[^"]*"[\s\S]*?<\/article>/g;
  let m;
  while ((m = re.exec(html))) {
    const b = m[0];
    const href = (b.match(/href="(https:\/\/madou\.casa\/[^"]+\.html)"/) || [])[1] || '';
    if (!href) continue;
    const title = clean((b.match(/<h2[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/) || [])[1] || '');
    if (!title) continue;
    const cover = (b.match(/data-src="([^"]+)"/) || [])[1] || '';
    const views = (b.match(/post-view"[^>]*>([^<]*)</) || [])[1] || '';
    const fullPath = href.replace('https://madou.casa', '');
    items.push({
      id: decodeURIComponent(fullPath).replace(/^\//, ''),
      title,
      path: fullPath,
      coverUrl: cover || null,
      views: (views.match(/观看\(([^)]+)\)/) || [])[1] || null,
    });
  }
  return items;
}

function hasNextPage(html) {
  return /<a[^>]+href="[^"]*page[^"]*"[^>]*>下一页<\/a>/.test(html);
}

function parseDetail(html) {
  const title = clean((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || '');
  const art = html.match(/<article class="madou_casa-article-content"[\s\S]*?<\/article>/) || [''];
  const shareId = (art[0].match(/dash\.madou\.casa\/share\/([a-f0-9]{24})/) || [])[1] || '';
  const covers = [...new Set([...html.matchAll(/https:\/\/madou\.casa\/covers\/[^"')\s]+/g)].map((x) => x[0]))];
  const cover = covers.find((u) => !/-\d+x\d+\.(jpe?g|png|webp)$/.test(u)) || covers[0] || '';
  const views = (html.match(/观看\(([^)]+)\)/) || [])[1] || '';
  return { title, shareId, coverUrl: cover || null, views };
}

async function posts(site, url, h) {
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const feedId = (url.searchParams.get('feed') || '').trim();
  const q = (url.searchParams.get('q') || '').trim();
  let upstream;
  let hasRank = false;
  if (q) {
    upstream = new URL(UPSTREAM);
    upstream.pathname = page > 1 ? `/page/${page}` : '/';
    upstream.searchParams.set('s', q);
  } else if (feedId.startsWith('_')) {
    upstream = new URL(UPSTREAM + '/' + encodeURIComponent(feedId.slice(1)));
    hasRank = true;
  } else if (feedId && feedId !== 'home') {
    upstream = new URL(UPSTREAM + '/category/' + encodeURIComponent(feedId) + (page > 1 ? `/page/${page}` : ''));
  } else {
    upstream = new URL(UPSTREAM + (page > 1 ? `/page/${page}` : '/'));
  }
  const html = await h.upstream(site, upstream.toString(), { referer: UPSTREAM + '/' });
  const list = parseItems(html);
  const hasNext = hasRank ? false : hasNextPage(html);
  return h.json({ ok: true, page, hasNext, totalPages: hasNext ? null : 1, query: q || null, posts: list });
}

async function post(site, url, h) {
  const segments = url.pathname.split('/').filter(Boolean);
  const id = decodeURIComponent(segments[segments.length - 1] || '');
  if (!/^[^/?#\s]{1,200}$/.test(id)) return h.json({ ok: false, error: '内容 ID 无效' }, 400);
  if (!id.endsWith('.html')) return h.json({ ok: false, error: '内容 ID 无效' }, 400);
  const path = '/' + id;
  const html = await h.upstream(site, UPSTREAM + path, { referer: UPSTREAM + '/' });
  const detail = parseDetail(html);
  if (!detail.title && !detail.shareId) return h.json({ ok: false, error: '内容不存在' }, 404);
  return h.json({
    ok: true,
    post: {
      id,
      title: detail.title,
      description: null,
      author: null,
      dateText: null,
      views: detail.views || null,
      favorites: null,
      likes: null,
      duration: null,
      coverUrl: detail.coverUrl,
      tags: [],
      playUrl: detail.shareId ? `/api/madou/play?id=${detail.shareId}` : null,
      poster: null,
      related: [],
    },
  }, 200, 'no-store');
}

const tokenStore = new Map();

async function getToken(id, h) {
  const now = Date.now();
  const cached = tokenStore.get(id);
  if (cached && now - cached.at < 60000) return cached.token;
  const res = await fetch(`${DASH}/share/${id}?cb=${now}`, {
    headers: { 'User-Agent': h.ua, 'Accept-Language': 'zh-CN,zh;q=0.9' },
  });
  if (!res.ok) throw new Error('share ' + res.status);
  const html = await res.text();
  const token = (html.match(/var token = "([^"]+)"/) || [])[1] || '';
  if (token) tokenStore.set(id, { token, at: now });
  return token;
}

async function play(site, url, h) {
  const id = url.searchParams.get('id') || '';
  const seg = url.searchParams.get('seg') || '';
  if (!/^[a-f0-9]{24}$/.test(id)) return h.json({ ok: false, error: '参数无效' }, 400);
  if (seg) {
    let target;
    try {
      target = new URL(seg);
    } catch {
      return h.json({ ok: false, error: '分片地址无效' }, 400);
    }
    let res;
    try {
      res = await fetch(target.toString(), { headers: { 'User-Agent': h.ua, 'Accept-Language': 'zh-CN,zh;q=0.9' } });
    } catch {
      return h.json({ ok: false, error: '上游不可达' }, 502);
    }
    if (!res.ok) return h.json({ ok: false, error: '上游 ' + res.status }, 502);
    return new Response(res.body, {
      status: 200,
      headers: {
        'Content-Type': res.headers.get('Content-Type') || 'video/MP2T',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  }
  let token;
  try {
    token = await getToken(id, h);
  } catch {
    return h.json({ ok: false, error: '播放地址不可用' }, 502);
  }
  if (!token) return h.json({ ok: false, error: '播放地址不可用' }, 404);
  let res;
  try {
    res = await fetch(`${DASH}/videos/${id}/index.m3u8?token=${encodeURIComponent(token)}`, {
      headers: { 'User-Agent': h.ua, 'Accept-Language': 'zh-CN,zh;q=0.9' },
    });
  } catch {
    return h.json({ ok: false, error: '播放列表获取失败' }, 502);
  }
  if (!res.ok) return h.json({ ok: false, error: '上游 ' + res.status }, 502);
  const base = `${DASH}/videos/${id}/`;
  const text = (await res.text()).split('\n').map((line) => {
    const l = line.trim();
    if (l && !l.startsWith('#') && !/^https?:\/\//i.test(l)) {
      const [p, qs] = line.split('?');
      return '/api/madou/play?id=' + id + '&seg=' + encodeURIComponent(qs ? base + p + '?' + qs : base + p);
    }
    if (l && l.startsWith('#')) {
      const keyM = line.match(/^#EXT-X-KEY:[^"]*URI="([^"]+)"/);
      if (keyM) {
        const abs = new URL(keyM[1], base).toString();
        return line.replace(keyM[1], '/api/madou/play?id=' + id + '&seg=' + encodeURIComponent(abs));
      }
    }
    return line;
  }).join('\n');
  return new Response(text, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=60',
    },
  });
}

export { posts, post, play };
