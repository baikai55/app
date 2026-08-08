'use strict';

const UPSTREAM = 'https://www.madouai.xyz';

async function apiGet(site, path, params, h) {
  const url = new URL(`${UPSTREAM}/api/v1${path}`);
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const text = await h.upstream(site, url.toString(), { headers: { Accept: 'application/json' } });
  const data = JSON.parse(text);
  if (!data || data.code !== 200) throw new Error(data?.message || '上游 API 异常');
  return data.data;
}

function toCard(item) {
  const id = String(item.id ?? '');
  if (!id) return null;
  const cover = String(item.coverUrl || '');
  return {
    id,
    title: String(item.title || ''),
    duration: item.durationSec ? formatDuration(Number(item.durationSec)) : null,
    views: item.viewCount != null ? Number(item.viewCount) : null,
    coverUrl: normalizeCover(cover),
  };
}

function normalizeCover(cover) {
  if (!cover) return null;
  const value = String(cover);
  let path = value.replace(/^https?:\/\/[^/]+/i, '').replace(/^\/+/, '');
  path = path.replace(/^api\/v1\/image\/proxy\?path=/i, '').replace(/^\/+/, '');
  try {
    path = decodeURIComponent(path);
  } catch {
    // keep as-is
  }
  return `/api/madouai/image?path=${encodeURIComponent(path)}`;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const hh = Math.floor(seconds / 3600);
  const mm = Math.floor((seconds % 3600) / 60);
  const ss = seconds % 60;
  if (hh > 0) return `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

function normalizePlay(videoUrl) {
  if (!videoUrl) return null;
  const value = String(videoUrl);
  if (/^https?:\/\//i.test(value)) return `/api/madouai/play?path=${encodeURIComponent(value)}`;
  return `/api/madouai/play?path=${encodeURIComponent(value.replace(/^\//, ''))}`;
}

async function posts(site, url, h) {
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const feedId = url.searchParams.get('feed') || '';
  const q = (url.searchParams.get('q') || '').trim();
  const data = await apiGet(site, '/videos', { page, pageSize: 24, categoryId: feedId || undefined, keyword: q || undefined }, h);
  const list = (Array.isArray(data.items) ? data.items : []).map(toCard).filter(Boolean);
  const totalPages = Number(data.totalPages) || 0;
  return h.json({
    ok: true,
    page,
    hasNext: page < totalPages,
    totalPages: totalPages || null,
    query: q || null,
    posts: list,
  });
}

async function post(site, url, h) {
  const segments = url.pathname.split('/').filter(Boolean);
  const id = decodeURIComponent(segments[segments.length - 1] || '');
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) return h.json({ ok: false, error: '视频 ID 无效' }, 400);
  const data = await apiGet(site, `/videos/${id}`, {}, h);
  const video = data?.video || data;
  if (!video || !video.id) return h.json({ ok: false, error: '内容不存在' }, 404);
  const cover = String(video.coverUrl || '');
  return h.json({
    ok: true,
    post: {
      id: String(video.id),
      title: String(video.title || ''),
      description: video.description || null,
      author: video.author || null,
      dateText: video.createdAt || null,
      views: video.viewCount != null ? Number(video.viewCount) : null,
      favorites: null,
      likes: null,
      duration: video.durationSec ? formatDuration(Number(video.durationSec)) : null,
      coverUrl: normalizeCover(cover),
      tags: Array.isArray(video.tags) ? video.tags.map(String) : [],
      playUrl: normalizePlay(video.videoUrl),
      poster: null,
      related: [],
    },
  }, 200, 'no-store');
}

async function image(site, url, h) {
  const path = url.searchParams.get('path') || '';
  if (!path) return h.json({ ok: false, error: '缺少 path' }, 400);
  const target = `${UPSTREAM}/api/v1/image/proxy?path=${encodeURIComponent(path)}`;
  let res;
  try {
    res = await fetch(target, { headers: { 'User-Agent': h.ua } });
  } catch {
    return h.json({ ok: false, error: '上游不可达' }, 502);
  }
  if (!res.ok) return h.json({ ok: false, error: '上游 ' + res.status }, 502);
  return new Response(res.body, {
    status: 200,
    headers: {
      'Content-Type': res.headers.get('Content-Type') || 'image/jpeg',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}

async function play(site, url, h) {
  const path = url.searchParams.get('path') || '';
  if (!path) return h.json({ ok: false, error: '缺少 path' }, 400);
  const target = `${UPSTREAM}/api/v1/m3u8/proxy?path=${encodeURIComponent(path)}`;
  let res;
  try {
    res = await fetch(target, { headers: { 'User-Agent': h.ua } });
  } catch {
    return h.json({ ok: false, error: '上游不可达' }, 502);
  }
  if (!res.ok) return h.json({ ok: false, error: '上游 ' + res.status }, 502);
  let text;
  try {
    text = await res.text();
  } catch {
    return h.json({ ok: false, error: '上游读取失败' }, 502);
  }
  const lines = text.split(/\r?\n/).map((line) => {
    if (!line || line.startsWith('#')) {
      const keyM = line.match(/^#EXT-X-KEY:[^"]*URI="([^"]+)"/);
      if (keyM) {
        return line.replace(keyM[1], '/api/madouai/key');
      }
      return line;
    }
    if (/^https?:\/\//i.test(line)) return line;
    const abs = new URL(line, UPSTREAM + '/').toString();
    return abs;
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

async function key(site, h) {
  let res;
  try {
    res = await fetch(`${UPSTREAM}/api/v1/m3u8/key`, { headers: { 'User-Agent': h.ua } });
  } catch {
    return h.json({ ok: false, error: '上游不可达' }, 502);
  }
  if (!res.ok) return h.json({ ok: false, error: '上游 ' + res.status }, 502);
  return new Response(res.body, {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=300',
    },
  });
}

export { posts, post, image, play, key };
