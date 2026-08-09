'use strict';

const UPSTREAM = 'https://haijiao.com';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';

const CATEGORY_MAP = {
  hot: { path: '/api/topic/hot/topics' },
  news: { path: '/api/topic/node/news' },
  events: { path: '/api/topic/node/topics', query: { type: '1', nodeId: '258' } },
  original: { path: '/api/topic/node/topics', query: { type: '7' } },
  essence: { path: '/api/topic/node/topics', query: { type: '3', nodeId: '0' } },
  notice: { path: '/api/topic/node/topics', query: { type: '0', nodeId: '14' } },
  latest: { path: '/api/topic/node/topics', query: { type: '1', nodeId: '0' } },
  all: { path: '/api/topic/node/topics' },
};

function b64d(s) {
  try {
    const bin = atob(String(s || '').replace(/\s+/g, ''));
    return decodeURIComponent(
      Array.from(bin, (ch) => '%' + ch.charCodeAt(0).toString(16).padStart(2, '0')).join(''),
    );
  } catch {
    return '';
  }
}

function tripleDecode(payload) {
  let text = payload;
  for (let i = 0; i < 3; i++) text = b64d(text);
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error('解码失败: ' + String(e).slice(0, 80));
  }
}

function tokenFrom(h) {
  return { token: h.env?.HJ_TOKEN || '', userId: h.env?.HJ_UID || '' };
}

async function upstreamFetch(path, init, token, userId) {
  const headers = {
    'User-Agent': UA,
    Accept: 'application/json',
    Referer: UPSTREAM + '/home',
    Origin: UPSTREAM,
  };
  if (token) headers['X-User-Token'] = token;
  if (userId) headers['X-User-Id'] = userId;
  if (init && init.headers) Object.assign(headers, init.headers);
  return fetch(UPSTREAM + path, Object.assign({}, init, { headers }));
}

async function unwrap(resp) {
  const text = await resp.text();
  if (!resp.ok) throw new Error('HTTP ' + resp.status + ': ' + text.slice(0, 120));
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error('非 JSON: ' + text.slice(0, 120));
  }
  if (j.isEncrypted && j.data) {
    j = tripleDecode(j.data);
  }
  return j;
}

const HJ_IMG_B64_ALPHABET = 'ABCD*EFGHIJKLMNOPQRSTUVWX#YZabcdefghijklmnopqrstuvwxyz1234567890';

function hjImageCustomDecode(cipherText) {
  const e = HJ_IMG_B64_ALPHABET;
  const t = String(cipherText || '').replace(/[^A-Za-z0-9*#]/g, '');
  let l = '';
  let d = 0;
  while (d < t.length) {
    const charAt = (pos) => (pos < t.length ? t.charAt(pos) : '');
    let o = e.indexOf(charAt(d++));
    let r = e.indexOf(charAt(d++));
    let s = e.indexOf(charAt(d++));
    let c = e.indexOf(charAt(d++));
    if (o < 0) o = 0;
    if (r < 0) r = 0;
    if (s < 0) s = 64;
    if (c < 0) c = 64;
    const i = ((15 & r) << 4) | (s >> 2);
    const n = ((3 & s) << 6) | c;
    l += String.fromCharCode((o << 2) | (r >> 4));
    if (s !== 64) l += String.fromCharCode(i);
    if (c !== 64) l += String.fromCharCode(n);
  }
  let out = '';
  let n1 = 0;
  while (n1 < l.length) {
    const t1 = l.charCodeAt(n1);
    if (t1 < 128) {
      out += String.fromCharCode(t1);
      n1 += 1;
    } else if (t1 > 191 && t1 < 224) {
      const o1 = l.charCodeAt(n1 + 1);
      out += String.fromCharCode(((31 & t1) << 6) | (63 & o1));
      n1 += 2;
    } else {
      const o1 = l.charCodeAt(n1 + 1);
      const a1 = l.charCodeAt(n1 + 2);
      out += String.fromCharCode(((15 & t1) << 12) | ((63 & o1) << 6) | (63 & a1));
      n1 += 3;
    }
  }
  return out;
}

function dataUrlToBytes(dataUrl) {
  const m = String(dataUrl || '').match(/^data:([^;,]+);base64,(.+)$/s);
  if (!m) return null;
  try {
    let b64 = m[2].replace(/[\s\u0000-\u001f]+/g, '');
    const pad = b64.length % 4;
    if (pad) b64 += '='.repeat(4 - pad);
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { mime: m[1], bytes };
  } catch {
    return null;
  }
}

function clean(s) {
  return String(s ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function mediaUrl(url) {
  if (!url) return '';
  if (String(url).startsWith('/')) return url;
  return '/api/hj/image?url=' + encodeURIComponent(url);
}

function topicToPost(raw) {
  const attachments = raw.attachments || [];
  const videos = attachments
    .filter((a) => /video/i.test(String(a.category || '')))
    .map((a) => ({
      id: a.id,
      title: a.title || '',
      remoteUrl: a.remoteUrl || '',
      coverUrl: a.coverUrl || '',
    }));
  const images = attachments
    .filter((a) => /image/i.test(String(a.category || '')))
    .map((a) => ({ id: a.id, source: a.remoteUrl || '', url: mediaUrl(a.remoteUrl) || '' }));
  const firstImage = images[0] || (videos[0] && { source: videos[0].coverUrl });

  let cover = '';
  if (firstImage && firstImage.source) cover = mediaUrl(firstImage.source);
  if (!cover && raw.user && raw.user.avatar) {
    cover = mediaUrl('https://pic.hj260302818.top/hjstore/system/user/' + raw.user.avatar + '.png');
  }

  const tagList = Array.isArray(raw.tags)
    ? raw.tags.map((t) => (typeof t === 'string' ? t : t.name || '')).filter(Boolean)
    : [];

  return {
    id: raw.topicId,
    title: clean(raw.title || ''),
    author: (raw.user && raw.user.nickname) || '',
    category: (raw.node && raw.node.name) || '',
    views: raw.viewCount || 0,
    likes: raw.likeCount || 0,
    comments: raw.commentCount || 0,
    createdAt: raw.createTime || '',
    summary: clean(raw.liteContent || ''),
    tags: tagList,
    coverUrl: cover,
    hasVideo: !!raw.hasVideo || videos.length > 0,
    hasPic: !!raw.hasPic,
    videos,
    images,
    playUrl: null,
  };
}

function attachmentToCard(att) {
  const title = clean(att.title || '');
  if (!title) return null;
  let cover = '';
  if (att.coverUrl) cover = mediaUrl(att.coverUrl);
  return {
    id: att.id,
    title,
    coverUrl: cover,
    views: att.viewCount != null ? att.viewCount : null,
    duration: null,
    site: 'hj',
  };
}

async function fetchFeedJson(filter, page, pageSize, token, userId) {
  const map = CATEGORY_MAP[filter] || CATEGORY_MAP.hot;
  const qs = new URLSearchParams(map.query || {});
  qs.set('page', String(page));
  qs.set('limit', String(pageSize));
  if (qs.has('type')) qs.set('type', qs.get('type') || '1');
  const resp = await upstreamFetch(map.path + '?' + qs.toString(), {}, token, userId);
  const data = await unwrap(resp);
  return data;
}

function m3u8StemFromTsNames(names) {
  const bare = (names || [])
    .map((n) => String(n || '').split('?')[0].split('/').pop() || '')
    .map((n) => n.replace(/\.ts$/i, ''))
    .filter(Boolean);
  if (!bare.length) return '';
  if (bare.length === 1) return bare[0].replace(/\d+$/, '');
  let lcp = bare[0];
  for (let i = 1; i < bare.length; i++) {
    const s = bare[i];
    let j = 0;
    while (j < lcp.length && j < s.length && lcp.charAt(j) === s.charAt(j)) j++;
    lcp = lcp.slice(0, j);
    if (!lcp) return '';
  }
  return lcp;
}

function playlistStats(content) {
  let duration = 0;
  const re = /#EXTINF:([0-9.]+)/g;
  let m;
  while ((m = re.exec(String(content || ''))) !== null) {
    const n = parseFloat(m[1]);
    if (!isNaN(n)) duration += n;
  }
  return {
    duration,
    tsCount: (String(content || '').match(/\.ts(\?|$)/gi) || []).length,
  };
}

const upgradeCache = new Map();

async function proxyFetch(target) {
  const headers = { 'User-Agent': UA, Referer: UPSTREAM + '/', Origin: UPSTREAM };
  return fetch(target, { headers });
}

async function tryUpgradePlaylistUrl(playUrl) {
  if (!playUrl || !/\.m3u8/i.test(playUrl)) return playUrl;
  const hit = upgradeCache.get(playUrl);
  if (hit && Date.now() - hit.ts < 10 * 60 * 1000) return hit.url;
  let result = playUrl;
  try {
    const preview = await proxyFetch(playUrl);
    if (preview.ok) {
      const text = await preview.text();
      if (text.includes('#EXTM3U')) {
        const tsNames = text
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith('#') && /\.ts/i.test(l));
        const stem = m3u8StemFromTsNames(tsNames);
        if (stem) {
          const full = new URL(playUrl);
          const slash = full.pathname.lastIndexOf('/');
          full.pathname = full.pathname.slice(0, slash + 1) + stem + '.m3u8';
          const fullResp = await proxyFetch(full.toString());
          if (fullResp.ok) {
            const fullText = await fullResp.text();
            if (fullText.includes('#EXTM3U')) {
              const p = playlistStats(text);
              const f = playlistStats(fullText);
              if (f.tsCount > p.tsCount || f.duration > p.duration + 15) {
                result = full.toString();
              }
            }
          }
        }
      }
    }
  } catch {}
  if (upgradeCache.size > 200) upgradeCache.clear();
  upgradeCache.set(playUrl, { url: result, ts: Date.now() });
  return result;
}

function rewritePlaylist(text, base) {
  const lines = text.split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('#EXT-X-KEY:')) {
      let rewritten = line;
      const uriMatch = rewritten.match(/(URI\s*=\s*)(["'])(.*?)\2/i);
      if (uriMatch) {
        let full = uriMatch[3];
        try {
          full = new URL(uriMatch[3], base).toString();
        } catch {}
        const proxied = '/api/hj/key?url=' + encodeURIComponent(full);
        rewritten =
          rewritten.slice(0, uriMatch.index) +
          uriMatch[1] +
          '"' +
          proxied +
          '"' +
          rewritten.slice(uriMatch.index + uriMatch[0].length);
      }
      out.push(rewritten);
      continue;
    }
    if (!t || t.startsWith('#')) {
      out.push(line);
      continue;
    }
    let full = t;
    try {
      full = new URL(t, base).toString();
    } catch {}
    out.push('/api/hj/proxy?url=' + encodeURIComponent(full));
  }
  return out.join('\n');
}

async function posts(site, url, h) {
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const filter = (url.searchParams.get('feed') || 'hot').trim();
  const keyword = (url.searchParams.get('q') || '').trim();
  const { token, userId } = tokenFrom(h);
  const qs = new URLSearchParams({ page: String(page), limit: '20' });
  if (keyword) qs.set('keyword', keyword);
  const map = CATEGORY_MAP[filter] || CATEGORY_MAP.hot;
  const apiQs = new URLSearchParams(map.query || {});
  for (const [k, v] of qs.entries()) apiQs.set(k, v);
  if (apiQs.has('type')) apiQs.set('type', apiQs.get('type') || '1');
  try {
    const data = await fetchFeedJson(filter, page, 20, token, userId);
    const rawTopics = data.results || data.posts || data.list || [];
    const posts = rawTopics.map(topicToPost).filter((p) => p.title && p.id);
    return h.json({ ok: true, page, totalPages: 0, posts, hasNext: posts.length >= 20 });
  } catch (e) {
    return h.json({ ok: false, error: e.message || '列表加载失败' }, 502);
  }
}

async function post(site, url, h) {
  const segments = url.pathname.split('/').filter(Boolean);
  const id = decodeURIComponent(segments[segments.length - 1] || '');
  if (!/^\d+$/.test(id)) return h.json({ ok: false, error: '请求参数无效' }, 400);
  const { token, userId } = tokenFrom(h);
  try {
    const resp = await upstreamFetch('/api/topic/' + encodeURIComponent(id), {}, token, userId);
    const data = await unwrap(resp);
    if (data.message === '帖子不存在' || !data.topicId) {
      return h.json({ ok: false, error: data.message || '帖子不存在' }, 404);
    }
    const post = topicToPost(data);
    const video = post.videos[0] || null;
    let playUrl = null;
    let needLogin = false;
    let resolveMessage = '';
    if (video) {
      if (video.remoteUrl && /\.m3u8/i.test(video.remoteUrl)) {
        playUrl = '/api/hj/play?url=' + encodeURIComponent(video.remoteUrl);
      } else {
        try {
          const playResp = await upstreamFetch(
            '/api/attachment',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                id: Number(video.id),
                resource_id: Number(post.id) || Number(video.id),
                resource_type: 'topic',
                line: '',
              }),
            },
            token,
            userId,
          );
          const text = await playResp.text();
          let pd = {};
          try {
            pd = JSON.parse(text);
          } catch {
            if (/\.m3u8/i.test(text)) {
              playUrl = '/api/hj/play?url=' + encodeURIComponent(text.trim());
              pd = null;
            }
          }
          if (pd) {
            if (pd.isEncrypted && pd.data) {
              try {
                pd = tripleDecode(pd.data);
              } catch {}
            }
            const url = pd.remoteUrl || pd.playUrl || pd.url || pd.m3u8 || pd.videoUrl || pd.address || '';
            if (url && /\.m3u8/i.test(url)) {
              playUrl = '/api/hj/play?url=' + encodeURIComponent(url);
            } else if (url) {
              playUrl = url;
            } else {
              const msg = pd.message || pd.msg || '';
              needLogin = /login|token|登录|未登录/i.test(msg);
              resolveMessage = msg || '播放需要海角账号 token';
            }
          }
        } catch (e) {
          resolveMessage = e.message || '播放地址解析失败';
        }
      }
    }
    return h.json({
      ok: true,
      post: {
        id: post.id,
        title: post.title,
        author: post.author,
        views: post.views,
        likes: post.likes,
        comments: post.comments,
        dateText: post.createdAt ? String(post.createdAt).slice(0, 10) : null,
        summary: post.summary,
        description: post.summary || null,
        tags: post.tags,
        coverUrl: post.coverUrl,
        videos: post.videos.map((v) => ({ id: v.id, title: v.title, remoteUrl: v.remoteUrl })),
        images: post.images,
        playUrl,
        needLogin,
        resolveMessage,
        isHls: !!(playUrl && /\/api\/hj\/(play|key|proxy)/.test(playUrl)),
      },
    }, 200, 'no-store');
  } catch (e) {
    return h.json({ ok: false, error: e.message || '详情加载失败' }, 502);
  }
}

async function play(site, url, h) {
  const targetRaw = url.searchParams.get('url') || '';
  if (!/^https:\/\//.test(targetRaw)) return h.json({ ok: false, error: '地址无效' }, 400);
  let target;
  try {
    target = new URL(targetRaw);
  } catch {
    return h.json({ ok: false, error: '地址无效' }, 400);
  }
  const upgraded = await tryUpgradePlaylistUrl(target.toString());
  const resp = await proxyFetch(upgraded);
  if (!resp.ok) return new Response(await resp.text(), { status: resp.status });
  const text = await resp.text();
  const rewritten = rewritePlaylist(text, upgraded);
  return new Response(rewritten, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.apple.mpegurl',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=30',
    },
  });
}

async function key(site, url, h) {
  const target = url.searchParams.get('url') || '';
  if (!/^https:\/\//.test(target)) return h.json({ ok: false, error: '地址无效' }, 400);
  const resp = await proxyFetch(target);
  return new Response(resp.body, {
    status: resp.status,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

async function proxy(site, url, h) {
  const target = url.searchParams.get('url') || '';
  if (!/^https:\/\//.test(target)) return h.json({ ok: false, error: '地址无效' }, 400);
  const resp = await proxyFetch(target);
  const upstreamCt = resp.headers.get('Content-Type') || '';
  const isTs = /\.ts($|\?)/i.test(new URL(target).pathname);
  const ct = isTs ? 'video/mp2t' : upstreamCt || 'application/octet-stream';
  return new Response(resp.body, {
    status: resp.status,
    headers: {
      'Content-Type': ct,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600',
    },
  });
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
  const resp = await proxyFetch(target.toString());
  if (!resp.ok) return new Response(await resp.text(), { status: resp.status });
  if (/\.txt$/i.test(target.pathname)) {
    const text = await resp.text();
    const decoded = hjImageCustomDecode(text);
    const dataUrl = dataUrlToBytes(decoded);
    if (dataUrl) {
      return new Response(dataUrl.bytes, {
        status: 200,
        headers: {
          'Content-Type': dataUrl.mime || 'application/octet-stream',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=86400',
        },
      });
    }
    return new Response(text, {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' },
    });
  }
  const ct = resp.headers.get('Content-Type') || 'image/jpeg';
  return new Response(resp.body, {
    status: resp.status,
    headers: {
      'Content-Type': ct,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}

export { posts, post, play, image, key, proxy };
