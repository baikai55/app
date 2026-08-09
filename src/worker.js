'use strict';

import { SITES, findSite } from './lib/catalog.js';
import * as parse from './lib/parse.js';
import * as avjb from './lib/avjb.js';
import * as dom from './lib/dom.js';
import * as kan91 from './sites/kan91.js';
import * as mr from './sites/mr.js';
import * as tx from './sites/tx.js';
import * as rou from './sites/rou.js';
import * as best from './sites/best.js';
import * as madouai from './sites/madouai.js';
import * as madou from './sites/madou.js';
import * as hj from './sites/hj.js';

const SITE_MODULES = { kan91, mr, tx, rou, best, madouai, madou, hj };

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const json = (data, status = 200, cache = 'no-store') =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cache },
  });

const htmlHeaders = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' };

async function upstream(site, url, { method = 'GET', headers = {}, referer, allowHtml = false } = {}) {
  const res = await fetch(url, {
    method,
    redirect: 'follow',
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml,application/json,text/plain,*/*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.7',
      Referer: referer || site.baseUrl,
      ...headers,
    },
  });
  if (!res.ok) throw new Error(`上游源站响应异常 (${res.status})`);
  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  if (!allowHtml && /^(image|audio|video)\//.test(contentType) && !/mpegurl|x-mpegurl|vnd\.apple\.mpegurl/.test(contentType)) {
    throw new Error('上游返回了非文本内容');
  }
  const buf = await res.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    const enc = site.encoding && site.encoding !== 'utf-8' ? site.encoding : 'gbk';
    return new TextDecoder(enc).decode(buf);
  }
}

function moduleFor(site) {
  if (!site.module) return null;
  return SITE_MODULES[site.module] || null;
}

function buildListUrl(site, feed, page) {
  let path = feed.path || '/';
  if (page > 1) {
    if (site.pagination === 'path') {
      path = path.replace(/\/+$/, '') + '/page/' + page;
    } else if (site.pagination === 'path-trailing') {
      path = path.replace(/\/+$/, '') + '/' + page + '/';
    } else if (site.pagination === 'query') {
      const [base, qs] = path.split('?');
      const params = new URLSearchParams(qs || '');
      params.set('page', String(page));
      path = base + '?' + params.toString();
    }
  }
  return new URL(path, site.baseUrl).toString();
}

async function handleMeta() {
  return json({
    categories: SITES.map((site) => ({ id: site.id, name: site.name, isHome: site.id === 'ja' })),
    sites: SITES,
  });
}

function moduleContext(site, env) {
  return {
    fetch: (u, o) => fetch(u, o),
    ua: UA,
    baseUrl: site.baseUrl,
    upstream,
    json,
    env,
  };
}

async function handlePosts(site, url, env) {
  const mod = moduleFor(site);
  if (mod && typeof mod.posts === 'function') {
    return mod.posts(site, url, moduleContext(site, env));
  }
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const feedId = url.searchParams.get('feed') || site.feeds[0].id;
  const feed = site.feeds.find((f) => f.id === feedId) || site.feeds[0];
  const listUrl = buildListUrl(site, feed, page);
  const html = await upstream(site, listUrl);
  const posts = parse.parseVideoList(site, html, site.baseUrl);
  return json({ posts, page, hasNext: site.pagination !== 'none' && posts.length > 0, feed: feed.id });
}

async function resolvePlayback(site, ctx) {
  if (site.playback === 'avjb-rebuild') {
    const videoId = ctx.videoId;
    const segmentCount = await avjb.resolveSegmentCount(ctx, videoId);
    if (segmentCount && segmentCount > 0) {
      return { playUrl: `/api/${site.id}/play/${videoId}.m3u8`, isHls: true, rebuilt: segmentCount };
    }
    const embedUrl = new URL(`/newembed/${videoId}`, site.baseUrl).toString();
    try {
      const embedHtml = await upstream(site, embedUrl);
      const candidates = parse.mediaUrlsFromHtml(embedHtml, embedUrl);
      const mp4 = candidates.find((u) => {
        try {
          const host = new URL(u).host;
          return /\.(?:jb-aiwei\.cc|avstatic\.com)$/.test(host) && /\.mp4($|\?)/i.test(u.split('?')[0]);
        } catch {
          return false;
        }
      });
      if (mp4) return { playUrl: mp4, isHls: false };
    } catch {
      // fall through
    }
    return { playUrl: null };
  }
  if (ctx.parsed?.playUrl) {
    return { playUrl: ctx.parsed.playUrl, isHls: !!ctx.parsed.isHls };
  }
  return { playUrl: null };
}

async function findAvjbDetailUrl(site, videoId) {
  try {
    const homeHtml = await upstream(site, site.baseUrl);
    const m = new RegExp(`/video/${videoId}/[^"'<>\\s]+/?`).exec(homeHtml);
    if (m) return new URL(m[0], site.baseUrl).toString();
  } catch {
    // ignore
  }
  return null;
}

async function handlePost(site, url, env) {
  const mod = moduleFor(site);
  if (mod && typeof mod.post === 'function') {
    return mod.post(site, url, moduleContext(site, env));
  }
  const segments = url.pathname.split('/').filter(Boolean);
  const rawId = decodeURIComponent(segments[segments.length - 1] || '');
  const marker = site.contentId.marker || 'video';
  const isAvjb = site.id === 'ja';
  let videoId = rawId;
  let detailUrl = null;

  if (isAvjb && /^\d+\/[^/]+$/.test(rawId)) {
    const [idPart, slug] = rawId.split('/');
    videoId = idPart;
    detailUrl = new URL(`/video/${idPart}/${slug}/`, site.baseUrl).toString();
  } else if (isAvjb) {
    detailUrl = await findAvjbDetailUrl(site, videoId);
  } else {
    detailUrl = new URL(`/${marker}/${videoId}/`, site.baseUrl).toString();
  }

  let html = null;
  if (detailUrl) {
    try {
      html = await upstream(site, detailUrl);
    } catch (error) {
      if (!error.message.includes('响应异常')) throw error;
      if (isAvjb) detailUrl = await findAvjbDetailUrl(site, videoId);
      if (detailUrl) html = await upstream(site, detailUrl);
    }
  }
  if (!html && isAvjb) {
    detailUrl = new URL(`/newembed/${videoId}`, site.baseUrl).toString();
    html = await upstream(site, detailUrl);
  }
  if (!html) throw new Error('详情页获取失败');

  const parsed = parse.parseVideoDetails(site, html, detailUrl);
  const meta = parsePageMeta(html, detailUrl, videoId);
  const ctx = { fetch: (u, o) => fetch(u, o), ua: UA, baseUrl: site.baseUrl, videoId, parsed: parsed || undefined };
  const playback = await resolvePlayback(site, ctx);
  if (!playback.playUrl) throw new Error('播放地址暂时不可用');
  return json({
    post: {
      ...meta,
      ...(parsed || {}),
      id: videoId,
      playUrl: playback.playUrl,
      isHls: playback.isHls,
      rebuilt: playback.rebuilt || undefined,
    },
  });
}

function parsePageMeta(html, detailUrl, videoId) {
  const document = dom.parse(html);
  const pageText = parse.pageText(document);
  return {
    title: parse.findPageTitle(document) || '视频',
    posterUrl: parse.findPosterUrl(document, detailUrl),
    duration: parse.findDuration(document, pageText),
    author: parse.findAuthor(document),
    views: parse.findStat(pageText, '播放') || parse.findStat(pageText, '热度') || null,
    dateText: null,
    description: null,
    tags: [],
  };
}

async function handlePlay(site, url) {
  const id = url.pathname.split('/').filter(Boolean).pop()?.replace(/\.m3u8$/, '');
  if (!id || !/^\d+$/.test(id)) return json({ ok: false, error: '参数无效' }, 400);
  const ctx = { fetch: (u, o) => fetch(u, o), ua: UA, baseUrl: site.baseUrl, videoId: id };
  if (site.playback === 'avjb-rebuild') {
    const segmentCount = await avjb.resolveSegmentCount(ctx, id);
    if (!segmentCount) return json({ ok: false, error: '未找到可用分片' }, 404);
    const playlist = avjb.buildPlaylist(id, segmentCount);
    return new Response(playlist, {
      headers: {
        'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300',
      },
    });
  }
  return json({ ok: false, error: '该站点无需代理播放' }, 400);
}

const COVER_HOSTS = ['bmc.imgclh.com', 'bmc2.imgclh.com', 'bmc3.imgclh.com'];

async function handleCover(request) {
  const target = new URL(request.url).searchParams.get('url') || '';
  let cover;
  try {
    cover = new URL(target);
  } catch {
    return json({ error: '参数无效' }, 400);
  }
  if (!COVER_HOSTS.includes(cover.host)) return json({ error: '来源不允许' }, 403);
  const base = cover.pathname.replace(/\/[^/]+\.jpg$/, '');
  const candidates = ['4.jpg', '1.jpg', '2.jpg', '3.jpg', '5.jpg', '6.jpg', 'preview.jpg'];
  const name = cover.pathname.split('/').pop() || '';
  const names = [name, ...candidates.filter((n) => n !== name)];
  for (const candidate of names) {
    try {
      const res = await fetch(new URL(base + '/' + candidate, cover).toString(), {
        method: 'GET',
        headers: { 'User-Agent': UA, Accept: 'image/*' },
      });
      if (!res.ok) continue;
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      if (!ct.startsWith('image/')) continue;
      const bytes = new Uint8Array(await res.arrayBuffer());
      const looksImage =
        (bytes[0] === 0xff && bytes[1] === 0xd8) || // jpeg
        (bytes[0] === 0x89 && bytes[1] === 0x50) || // png
        (bytes[0] === 0x52 && bytes[1] === 0x49) || // webp RIFF
        (bytes[0] === 0x47 && bytes[1] === 0x49); // gif
      if (!looksImage) continue;
      return new Response(bytes, {
        status: 200,
        headers: {
          'Content-Type': ct,
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=86400',
        },
      });
    } catch {
      // try next
    }
  }
  return json({ error: '封面不可用' }, 404);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'GET' && (path === '/' || !path.startsWith('/api/'))) {
      const asset = await env.ASSETS.fetch(request);
      if (path === '/sw.js') {
        return new Response(asset.body, {
          status: asset.status,
          headers: {
            ...Object.fromEntries(asset.headers),
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Content-Type': 'application/javascript; charset=utf-8',
          },
        });
      }
      if (path === '/' || path === '/index.html') {
        const html = await asset.text();
        const version = 'v' + Math.floor(Date.now() / 60000);
        const patched = html
          .replace(/(\/css\/style\.css)(\?v=[^"']*)?/g, `/css/style.css?v=${version}`)
          .replace(/(\/js\/app\.js)(\?v=[^"']*)?/g, `/js/app.js?v=${version}`);
        return new Response(patched, {
          status: asset.status,
          headers: {
            ...Object.fromEntries(asset.headers),
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
          },
        });
      }
      return asset;
    }

    if (path === '/api/meta') return handleMeta();

    if (path === '/api/cover') {
      try {
        return await handleCover(request);
      } catch (error) {
        return json({ error: error.message || '封面不可用' }, 502);
      }
    }

    const siteMatch = path.match(/^\/api\/([a-z0-9-]+)\/(posts|post\/[^/]+|play\/[^/]+)/);
    if (siteMatch) {
      const site = findSite(siteMatch[1]);
      if (!site) return json({ error: '未知站点' }, 404);
      try {
        if (path.includes('/posts')) return await handlePosts(site, url, env);
        if (path.includes('/play/')) return await handlePlay(site, url);
        return await handlePost(site, url, env);
      } catch (error) {
        return json({ error: error.message || '服务暂时不可用' }, 502);
      }
    }

    const moduleRoute = path.match(/^\/api\/([a-z0-9-]+)\/(play|image|proxy|key)(?:\/|$)/);
    if (moduleRoute && !moduleRoute[2].includes('/')) {
      const site = findSite(moduleRoute[1]);
      if (!site) return json({ error: '未知站点' }, 404);
      const mod = moduleFor(site);
      if (mod && typeof mod[moduleRoute[2]] === 'function') {
        try {
          return await mod[moduleRoute[2]](site, url, moduleContext(site, env));
        } catch (error) {
          return json({ error: error.message || '服务暂时不可用' }, 502);
        }
      }
      return json({ error: '该站点不支持此接口' }, 400);
    }

    if (path === '/health') return json({ ok: true });

    return new Response('Not Found', { status: 404, headers: htmlHeaders });
  },
};
