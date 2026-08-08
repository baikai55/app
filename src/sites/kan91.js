'use strict';

const UPSTREAM = 'https://91porna.com';

function clean(s) {
  return String(s ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function durationText(seconds) {
  const n = Number(seconds);
  if (!isFinite(n) || n <= 0) return null;
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = Math.floor(n % 60);
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function parseCards(html) {
  const out = [];
  const seen = new Set();
  const blockRe = /<li><div class="video-item">([\s\S]*?)<\/li>/g;
  let m;
  while ((m = blockRe.exec(html))) {
    const block = m[1];
    const keyM = block.match(/comic\/index\/detail\?video_key=(\d+)/);
    if (!keyM) continue;
    const id = keyM[1];
    if (seen.has(id)) continue;
    const titleM = block.match(/line-clamp-2[^>]*>([\s\S]*?)<\/div>/);
    let title = titleM ? clean(titleM[1]) : '';
    if (!title) {
      const anyTitle = block.match(/<a[^>]*href="\/comic\/index\/detail[^"]*"[^>]*>([\s\S]*?)<\/a>/);
      title = anyTitle ? clean(anyTitle[1]) : '';
    }
    if (!title) continue;
    let cover = null;
    const srcRe = /data-src="(https:\/\/[^"]+)"/g;
    let sm;
    while ((sm = srcRe.exec(block))) {
      if (!sm[1].includes('poster_loading')) {
        cover = sm[1];
        break;
      }
    }
    if (!cover) {
      const im = block.match(/src="(https:\/\/[^"]+)"/);
      if (im && !im[1].includes('poster_loading')) cover = im[1];
    }
    const durM = block.match(/text-sm opacity-50[^>]*>\s*([^<]+?)\s*<\/div>/);
    const duration = durM ? durM[1].trim() : null;
    seen.add(id);
    out.push({ id, title, duration, coverUrl: normalizeCover(cover) });
  }
  return out;
}

function metaContent(html, prop) {
  const m = html.match(new RegExp(`<meta property="${prop}" content="([^"]*)"`));
  return m ? m[1] : null;
}

function parseDetail(html) {
  const tokenM = html.match(/[0-9a-f]{100,}/);
  if (!tokenM) return null;
  const token = tokenM[0];
  const title = clean(metaContent(html, 'og:title') || '');
  if (!title) return null;
  const description = clean(metaContent(html, 'og:description') || '');
  const duration = durationText(metaContent(html, 'video:duration'));
  const release = metaContent(html, 'video:release_date') || '';
  const coverM = html.match(/<meta name="twitter:image" content="([^"]*)"/);
  const cover = coverM ? coverM[1] : metaContent(html, 'og:image');
  const tags = [...html.matchAll(/<meta property="video:tag" content="([^"]*)"/g)].map((x) => x[1]);
  const viewsM = html.match(/fire\.png" alt="(\d+)"/);
  const views = viewsM ? Number(viewsM[1]) : null;
  const collectM = html.match(/collect-div[^>]*title="收藏数">[\s\S]*?<span>(\d+)<\/span>/);
  const likesM = html.match(/video-like[\s\S]*?<span>(\d+)<\/span>/);
  const videoIdM = html.match(/id="mse"[^>]*data-video="(\d+)"/);
  const videoId = videoIdM ? videoIdM[1] : null;
  return {
    token,
    title,
    description,
    duration,
    dateText: release.slice(0, 10) || null,
    views,
    favorites: collectM ? Number(collectM[1]) : null,
    likes: likesM ? Number(likesM[1]) : null,
    coverUrl: cover || null,
    tags,
    videoId,
  };
}

function normalizeCover(cover) {
  if (!cover) return null;
  return `/api/kan91/image?url=${encodeURIComponent(cover)}`;
}

async function image(site, url, h) {
  const targetRaw = url.searchParams.get('url') || '';
  if (!/^https:\/\//.test(targetRaw)) return h.json({ ok: false, error: '地址无效' }, 400);
  let target;
  try {
    target = new URL(targetRaw);
  } catch {
    return h.json({ ok: false, error: '地址无效' }, 400);
  }
  let res;
  try {
    res = await fetch(target.toString(), { headers: { 'User-Agent': h.ua, Referer: UPSTREAM + '/' } });
  } catch {
    return h.json({ ok: false, error: '上游不可达' }, 502);
  }
  if (!res.ok) return h.json({ ok: false, error: '上游 ' + res.status }, 502);
  const bytes = new Uint8Array(await res.arrayBuffer());
  let mime = 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50) mime = 'image/png';
  else if (bytes[0] === 0x52 && bytes[1] === 0x49) mime = 'image/webp';
  else if (bytes[0] === 0x47 && bytes[1] === 0x49) mime = 'image/gif';
  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': mime,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}

async function posts(site, url, h) {
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const cat = (url.searchParams.get('feed') || '').trim();
  const feed = site.feeds.find((f) => f.id === cat) || site.feeds[0];
  const query = (url.searchParams.get('q') || '').trim();
  const feedUrl = query
    ? `${UPSTREAM}/comic/index/search?keyword=${encodeURIComponent(query)}`
    : `${UPSTREAM}/comic/index/video?category=${encodeURIComponent(feed.category || 'play')}${page > 1 ? `&page=${page}` : ''}`;
  const html = await h.upstream(site, feedUrl, { referer: UPSTREAM + '/' });
  const list = parseCards(html);
  const next = html.match(/<link rel="next" href="([^"]*)"/);
  const hasNext = query ? false : !!next;
  return h.json({
    ok: true,
    page,
    hasNext,
    totalPages: hasNext ? null : 1,
    query: query || null,
    posts: list,
  });
}

async function post(site, url, h) {
  const segments = url.pathname.split('/').filter(Boolean);
  const id = decodeURIComponent(segments[segments.length - 1] || '');
  if (!/^\d+$/.test(id)) return h.json({ ok: false, error: '视频 ID 无效' }, 400);
  const detailUrl = `${UPSTREAM}/comic/index/detail?video_key=${id}`;
  const html = await h.upstream(site, detailUrl, { referer: UPSTREAM + '/' });
  const info = parseDetail(html);
  if (!info) return h.json({ ok: false, error: '内容不存在' }, 404);

  const videoId = info.videoId || id;
  const playUrl = info.token ? `/api/kan91/play?id=${videoId}` : null;

  const related = parseCards(html).filter((r) => r.id !== id).slice(0, 12);
  return h.json({
    ok: true,
    post: {
      id: info.videoId || id,
      title: info.title,
      description: info.description,
      author: null,
      dateText: info.dateText,
      views: info.views,
      favorites: info.favorites,
      likes: info.likes,
      duration: info.duration,
      coverUrl: normalizeCover(info.coverUrl),
      tags: info.tags,
      playUrl,
      related,
    },
  }, 200, 'no-store');
}

async function play(site, url, h) {
  const id = url.searchParams.get('id') || '';
  const seg = url.searchParams.get('seg') || '';
  if (!/^\d+$/.test(id)) return h.json({ ok: false, error: '视频 ID 无效' }, 400);

  if (seg) {
    let target;
    try {
      target = new URL(seg);
    } catch {
      return h.json({ ok: false, error: '分片地址无效' }, 400);
    }
    let res;
    try {
      res = await fetch(target.toString(), { headers: { 'User-Agent': h.ua, Referer: UPSTREAM + '/' } });
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

  const detailUrl = `${UPSTREAM}/comic/index/detail?video_key=${id}`;
  let html;
  try {
    html = await h.upstream(site, detailUrl, { referer: UPSTREAM + '/' });
  } catch {
    return h.json({ ok: false, error: '详情获取失败' }, 502);
  }
  const info = parseDetail(html);
  if (!info?.token) return h.json({ ok: false, error: '播放地址不可用' }, 404);

  const t = Math.floor(Date.now() / 1000 / 2100);
  let playText;
  try {
    playText = await h.upstream(
      site,
      `${UPSTREAM}/index/detail_play?u=${info.token}&t=${t}`,
      { referer: detailUrl, allowHtml: true },
    );
  } catch {
    return h.json({ ok: false, error: '播放地址不可用' }, 502);
  }
  const m3u8M = playText.match(/https:\/\/[^\s"'|\\]+?\.m3u8[^\s"'|\\]*/i);
  if (!m3u8M) return h.json({ ok: false, error: '播放地址不可用' }, 404);
  let m3u8Url;
  try {
    m3u8Url = new URL(m3u8M[0]);
  } catch {
    return h.json({ ok: false, error: '播放地址无效' }, 404);
  }
  let m3u8Text;
  try {
    const res = await fetch(m3u8Url.toString(), { headers: { 'User-Agent': h.ua, Referer: UPSTREAM + '/' } });
    if (!res.ok) return h.json({ ok: false, error: '上游 ' + res.status }, 502);
    m3u8Text = await res.text();
  } catch {
    return h.json({ ok: false, error: '播放列表获取失败' }, 502);
  }
  const lines = m3u8Text.split(/\r?\n/).map((line) => {
    if (!line || line.startsWith('#')) {
      const keyM = line.match(/^#EXT-X-KEY:[^"]*URI="([^"]+)"/);
      if (keyM) {
        const abs = new URL(keyM[1], m3u8Url).toString();
        return line.replace(keyM[1], `/api/kan91/play?id=${id}&seg=${encodeURIComponent(abs)}`);
      }
      return line;
    }
    const abs = new URL(line, m3u8Url).toString();
    return `/api/kan91/play?id=${id}&seg=${encodeURIComponent(abs)}`;
  });
  return new Response(lines.join('\n'), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=60',
    },
  });
}

export { posts, post, play, image };
