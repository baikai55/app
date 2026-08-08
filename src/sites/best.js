'use strict';

const UPSTREAM = 'https://www.bestjavporn.com';
const PROXY_DOMAINS = ['pianopic.com', 'streamhls.click'];

function clean(s) {
  return String(s ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeEntities(s) {
  return String(s ?? '')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#8217;/g, "'")
    .replace(/&#8216;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&#8230;/g, '…');
}

function isoDurationToText(value) {
  if (!value) return null;
  const m = value.match(/P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return null;
  const hours = (Number(m[1]) || 0) * 24 + (Number(m[2]) || 0);
  const minutes = Number(m[3]) || 0;
  const seconds = Number(m[4]) || 0;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function b64encodeStr(s) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  const bytes = Uint8Array.from(s, (ch) => ch.charCodeAt(0));
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += chars[b0 >> 2];
    out += chars[((b0 & 3) << 4) | (b1 === undefined ? 0 : b1 >> 4)];
    out += b1 === undefined ? '=' : chars[((b1 & 15) << 2) | (b2 === undefined ? 0 : b2 >> 6)];
    out += b2 === undefined ? '=' : chars[b2 & 63];
  }
  return out;
}

function b64decodeStr(s) {
  const t = atob(s);
  const out = new Uint8Array(t.length);
  for (let i = 0; i < t.length; i++) out[i] = t.charCodeAt(i);
  return out;
}

function rc4Decrypt(inputStr, encryptedB64, suffix) {
  const keyStr = b64encodeStr(inputStr + suffix).split('').reverse().join('');
  const keyBytes = Uint8Array.from(keyStr, (ch) => ch.charCodeAt(0) & 0xff);
  const enc = b64decodeStr(encryptedB64);
  const S = new Uint8Array(256);
  for (let i = 0; i < 256; i++) S[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + S[i] + keyBytes[i % keyBytes.length]) & 0xff;
    const t = S[i];
    S[i] = S[j];
    S[j] = t;
  }
  let i = 0;
  j = 0;
  const out = new Uint8Array(enc.length);
  for (let k = 0; k < enc.length; k++) {
    i = (i + 1) & 0xff;
    j = (j + S[i]) & 0xff;
    const t = S[i];
    S[i] = S[j];
    S[j] = t;
    out[k] = enc[k] ^ S[(S[i] + S[j]) & 0xff];
  }
  const latin = String.fromCharCode.apply(null, out);
  return new TextDecoder().decode(b64decodeStr(latin));
}

function parseCards(html) {
  const out = [];
  const seen = new Set();
  const cardRe = /<article[^>]*id="post-(\d+)"[^>]*class="[^"]*thumb-block[^"]*loop-video"[\s\S]*?<\/article>/g;
  let m;
  while ((m = cardRe.exec(html))) {
    const id = m[1];
    if (seen.has(id)) continue;
    const block = m[0];
    const hrefM = block.match(/<a[^>]*href="https:\/\/www\.bestjavporn\.com\/video\/([^"\/]+)\/"/);
    if (!hrefM) continue;
    const slug = hrefM[1];
    const titleM = block.match(/<a[^>]*title="([^"]*)"/);
    const title = titleM ? decodeEntities(titleM[1]).trim() : '';
    if (!title) continue;
    const durM = block.match(/<span class="duration">[\s\S]*?<\/i>\s*([^<]+?)\s*<\/span>/);
    const duration = durM ? durM[1].trim() : null;
    const viewsM = block.match(/<span class="views">[\s\S]*?<\/i>\s*([^<]+?)\s*<\/span>/);
    const views = viewsM ? viewsM[1].trim() : null;
    let cover = null;
    const lazyM = block.match(/data-lazy-src="(https:\/\/[^"]+)"/);
    if (lazyM) cover = lazyM[1];
    if (!cover) {
      const srcM = block.match(/src="(https:\/\/[^"]+)"/);
      if (srcM && !srcM[1].includes('data:image')) cover = srcM[1];
    }
    seen.add(id);
    out.push({ id: slug, slug, title, duration, views, coverUrl: cover });
  }
  return out;
}

function metaContent(html, attr, value) {
  const m = html.match(new RegExp(`<meta[^>]*${attr}="\\b${value}\\b"[^>]*content="([^"]*)"`));
  if (m) return m[1];
  const m2 = html.match(new RegExp(`<meta[^>]*content="([^"]*)"[^>]*${attr}="\\b${value}\\b"`));
  return m2 ? m2[1] : null;
}

function parseDetail(html) {
  const area = html.match(/id="video-player-area"[^>]*video-id="(\d+)"[^>]*video_ver="(\d+)"/);
  if (!area) return null;
  const videoId = area[1];
  const videoVersion = area[2];
  const mpuM = html.match(/id="video-player"[^>]*data-mpu="([^"]+)"/);
  if (!mpuM) return null;
  const encodedSources = mpuM[1];
  const titleM = html.match(/<h1[^>]*class="entry-title"[^>]*>([\s\S]*?)<\/h1>/);
  const title = titleM ? decodeEntities(clean(titleM[1])) : '';
  if (!title) return null;
  const duration = isoDurationToText(metaContent(html, 'itemprop', 'duration'));
  const cover = metaContent(html, 'itemprop', 'thumbnailUrl');
  const author = clean(metaContent(html, 'itemprop', 'author'));
  const viewsM = metaContent(html, 'itemprop', 'interactionCount');
  const views = viewsM ? Number(viewsM.replace(/\D/g, '')) : null;
  return { videoId, videoVersion, encodedSources, title, duration, coverUrl: cover || null, author: author || null, views };
}

function pickBestSource(sourcesJson) {
  let best = null;
  let bestScore = -1;
  for (const item of sourcesJson) {
    const file = String(item.file || '').trim();
    const type = String(item.type || '').toLowerCase();
    if (!/^https:\/\//.test(file)) continue;
    const isHls = type.includes('hls') || type.includes('mpegurl') || file.endsWith('.m3u8');
    const isMp4 = type.includes('mp4') || file.endsWith('.mp4');
    if (!isHls && !isMp4) continue;
    const labelNum = Number((String(item.label || '').match(/\d+/) || [0])[0]) || 0;
    const score = (isHls ? 10000 : 0) + labelNum;
    if (score > bestScore) {
      bestScore = score;
      best = { file, isHls };
    }
  }
  return best;
}

async function resolvePlayback(site, detail, detailUrl, h) {
  const step = (name) => { throw new Error('step:' + name); };
  try {
    var sources = rc4Decrypt(detail.videoId, detail.encodedSources, '_0x58fe15');
  } catch (e) {
    if (e?.message?.startsWith('step:')) throw e;
    throw new Error('rc4-sources failed');
  }
  let playJson;
  try {
    const playText = await h.upstream(
      site,
      `${UPSTREAM}/api/play/`,
      {
        referer: detailUrl,
        method: 'POST',
        body: `sources=${encodeURIComponent(sources)}&ver=${detail.videoVersion}`,
        headers: {
          Origin: UPSTREAM,
          'X-Requested-With': 'XMLHttpRequest',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        allowHtml: true,
      },
    );
    playJson = JSON.parse(playText);
  } catch (e) {
    if (e?.message?.startsWith('step:')) throw e;
    throw new Error('api-play failed: ' + (e?.message || e));
  }
  if (!playJson || !playJson.status || !playJson.data) throw new Error('api-play bad response');
  let playerUrl;
  try {
    playerUrl = rc4Decrypt(detail.videoId, playJson.data, '_0x58fe15').trim();
    if (playerUrl.startsWith('//')) playerUrl = 'https:' + playerUrl;
  } catch (e) {
    throw new Error('rc4-player failed: ' + (e?.message || e));
  }
  if (!/^https:\/\/[^"']+$/.test(playerUrl)) throw new Error('player-url invalid');
  let playerHtml;
  try {
    playerHtml = await h.upstream(site, playerUrl, { referer: detailUrl, allowHtml: true });
  } catch (e) {
    throw new Error('player-html failed: ' + (e?.message || e));
  }
  const configM = playerHtml.match(/id="jwplayer"[^>]*data-config="([^"]+)"/);
  if (!configM) throw new Error('no jwplayer config');
  const urlObj = new URL(playerUrl);
  const pathAndQuery = urlObj.pathname + (urlObj.search || '');
  const key = b64encodeStr(pathAndQuery).substring(4, 20);
  let configJson;
  try {
    configJson = rc4Decrypt(key, configM[1], '_0x59a0e4');
  } catch (e) {
    throw new Error('rc4-config failed: ' + (e?.message || e));
  }
  let config;
  try {
    config = JSON.parse(configJson);
  } catch (e) {
    throw new Error('config-parse failed: ' + (e?.message || e));
  }
  const srcB64 = String(config.src || '').trim();
  if (!srcB64) throw new Error('no config.src');
  let sourcesList;
  try {
    const decoded = new TextDecoder().decode(b64decodeStr(srcB64));
    sourcesList = JSON.parse(decoded);
  } catch (e) {
    throw new Error('sources-decode failed: ' + (e?.message || e));
  }
  const chosen = pickBestSource(Array.isArray(sourcesList) ? sourcesList : []);
  if (!chosen) throw new Error('no chosen source');
  let playUrl = chosen.file;
  try {
    const host = new URL(chosen.file).hostname;
    if (PROXY_DOMAINS.some((d) => host === d || host.endsWith('.' + d))) {
      playUrl = '/api/best/proxy?url=' + encodeURIComponent(chosen.file);
    }
  } catch {
    // keep raw
  }
  return { playUrl, poster: config.img ? decodeEntities(String(config.img).replace(/\\\//g, '/')) : null };
}

async function posts(site, url, h) {
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const cat = (url.searchParams.get('feed') || '').trim();
  const feed = site.feeds.find((f) => f.id === cat) || site.feeds[0];
  const query = (url.searchParams.get('q') || '').trim();
  let upstream;
  if (query) {
    upstream = page === 1
      ? `${UPSTREAM}/?s=${encodeURIComponent(query)}`
      : `${UPSTREAM}/search/${encodeURIComponent(query)}/page/${page}/`;
  } else if (feed && feed.isHome) {
    upstream = page > 1 ? `${UPSTREAM}/page/${page}/` : `${UPSTREAM}/`;
  } else {
    upstream = `${UPSTREAM}${feed.path}${page > 1 ? `page/${page}/` : ''}`;
  }
  const html = await h.upstream(site, upstream, { referer: UPSTREAM + '/' });
  const list = parseCards(html);
  const next = html.match(/<link rel="next" href="([^"]*)"/);
  const hasNext = !!next;
  return h.json({ ok: true, page, hasNext, totalPages: hasNext ? null : 1, query: query || null, posts: list });
}

async function post(site, url, h) {
  const segments = url.pathname.split('/').filter(Boolean);
  const id = decodeURIComponent(segments[segments.length - 1] || '');
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(id)) return h.json({ ok: false, error: '视频 ID 无效' }, 400);
  const detailUrl = `${UPSTREAM}/video/${id}/`;
  const html = await h.upstream(site, detailUrl, { referer: UPSTREAM + '/' });
  const info = parseDetail(html);
  if (!info) return h.json({ ok: false, error: '内容不存在' }, 404);
  let playUrl = null;
  let poster = null;
  let dbg = null;
  try {
    const playback = await resolvePlayback(site, info, detailUrl, h);
    if (playback) {
      playUrl = playback.playUrl;
      poster = playback.poster;
    } else {
      dbg = 'resolvePlayback returned null';
    }
  } catch (e) {
    dbg = 'resolvePlayback threw: ' + (e?.message || e);
  }
  const related = parseCards(html).filter((r) => r.slug !== id).slice(0, 12);
  return h.json({
    ok: true,
    post: {
      id,
      title: info.title,
      description: null,
      author: info.author,
      dateText: null,
      views: info.views,
      favorites: null,
      likes: null,
      duration: info.duration,
      coverUrl: info.coverUrl,
      tags: [],
      playUrl,
      poster,
      dbg,
      related,
    },
  }, 200, 'no-store');
}

async function proxy(site, url, h) {
  const targetUrl = url.searchParams.get('url') || '';
  if (!/^https:\/\/(pianopic\.com|streamhls\.click)(\/|$)/i.test(targetUrl)) {
    return h.json({ ok: false, error: '代理目标不允许' }, 403);
  }
  const target = new URL(targetUrl);
  let upstream;
  try {
    upstream = await fetch(targetUrl, { headers: { 'User-Agent': h.ua, Referer: UPSTREAM + '/' } });
  } catch {
    return h.json({ ok: false, error: '上游不可达' }, 502);
  }
  if (!upstream.ok) return h.json({ ok: false, error: '上游 ' + upstream.status }, 502);
  const ct = upstream.headers.get('Content-Type') || '';
  const isPlaylist = /mpegurl|hls|octet-stream|text/i.test(ct) || target.pathname.endsWith('.m3u8');
  if (isPlaylist) {
    let text;
    try {
      text = await upstream.text();
    } catch {
      return h.json({ ok: false, error: '上游读取失败' }, 502);
    }
    const base = target.href;
    const lines = text.split(/\r?\n/).map((line) => {
      if (!line || line.startsWith('#')) {
        const keyM = line.match(/^#EXT-X-KEY:[^"]*URI="([^"]+)"/);
        if (keyM) {
          const abs = new URL(keyM[1].replace(/\\\//g, '/'), base).href;
          return line.replace(keyM[1], '/api/best/proxy?url=' + encodeURIComponent(abs));
        }
        return line;
      }
      const abs = new URL(line.replace(/\\\//g, '/'), base).href;
      return '/api/best/proxy?url=' + encodeURIComponent(abs);
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
  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': ct || 'video/MP2T',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}

export { posts, post, proxy };
