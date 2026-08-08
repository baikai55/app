'use strict';

const UPSTREAM = 'https://www.mrds66.com';

function clean(s) {
  return String(s ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripTags(s) {
  return String(s ?? '').replace(/<[^>]*>/g, '');
}

function parseCards(html) {
  const posts = [];
  const articleRe = /<article[^>]*>([\s\S]*?)<\/article>/g;
  let m;
  while ((m = articleRe.exec(html))) {
    const b = m[1];
    if (/\bclass="ad-item"|\bad-item\b/.test(b)) continue;
    const hrefMatch = b.match(/<a href="\/(archives\/(\d+))\/"/);
    if (!hrefMatch) continue;
    const id = hrefMatch[2];
    const titleMatch = b.match(/<h2[^>]*class="post-card-title[^"]*"[^>]*>([\s\S]*?)<\/h2>/);
    if (!titleMatch) continue;
    const title = clean(titleMatch[1]);
    if (!title) continue;
    const cover = (b.match(/loadBannerDirect\(\s*'([^']+)'/) || [])[1] || '';
    const author = clean((b.match(/<span itemprop="author"[^>]*>([\s\S]*?)<\/span>/) || [])[1] || '');
    const dateMatch = b.match(/itemprop="datePublished" content="([^"]+)"/);
    const timeMatch = b.match(/<span itemprop="datePublished"[^>]*>([\s\S]*?)<\/span>/);
    const dateText = (dateMatch ? formatDate(dateMatch[1]) : '') || clean(timeMatch ? timeMatch[1] : '');
    const infoMatch = b.match(/<div class="post-card-info">([\s\S]*?)<\/div>/);
    const cats = [];
    if (infoMatch) {
      const spanRe = /<span>([\s\S]*?)<\/span>/g;
      let s;
      while ((s = spanRe.exec(infoMatch[1]))) {
        const text = clean(s[1]);
        if (text) cats.push(...text.split(',').map((x) => x.trim()).filter(Boolean));
      }
    }
    posts.push({
      id,
      title,
      author,
      dateText,
      categories: [...new Set(cats)],
      coverUrl: cover,
    });
  }
  return posts;
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()} 年 ${String(d.getMonth() + 1).padStart(2, '0')} 月 ${String(d.getDate()).padStart(2, '0')} 日`;
}

function parseTotalPages(html) {
  const m = html.match(/id="pageNum" data-num="(\d+)"/);
  if (m) return Math.max(1, Number(m[1]));
  const next = html.match(/<li class="next">[\s\S]*?<a href="[^"]*(?:\/\d+\/|\/page\/\d+\/)[^"]*"/);
  if (next) return 0;
  return 1;
}

function parseDetail(html, id) {
  let scope = html;
  const contentStart = html.indexOf('class="post-content"');
  if (contentStart >= 0) {
    const articleEnd = html.indexOf('</article>', contentStart);
    scope = html.slice(contentStart, articleEnd > 0 ? articleEnd : html.length);
  }

  const title = clean((html.match(/<h1[^>]*class="post-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || '');
  const authorMatch = html.match(/<li><a href="\/author\/\d+\/"[^>]*>([\s\S]*?)<\/a>/);
  const author = clean(authorMatch ? authorMatch[1] : '');
  const dateMatch = html.match(/<li><time>([\s\S]*?)<\/time>/);
  const dateText = clean(dateMatch ? dateMatch[1] : '');
  const metaMatch = html.match(/<ul class="post-meta">([\s\S]*?)<\/ul>/);
  const categories = [];
  if (metaMatch) {
    const catRe = /<a href="\/category\/([^"]+)\/">([\s\S]*?)<\/a>/g;
    let c;
    while ((c = catRe.exec(metaMatch[1]))) {
      const name = clean(c[2]);
      if (name) categories.push({ slug: c[1], name });
    }
  }
  const cover = (html.match(/<meta itemprop="image"[^>]*content="([^"]+)"/) || [])[1] || '';

  const textBlocks = [];
  const images = [];
  const contentScope = scope.replace(/<blockquote>[\s\S]*?<\/blockquote>/g, '');
  const promoRe = /热门大赛|QQ群|官方网址|分享每日大赛|AI魔改|点击可下载完整版视频|获取最新地址|永久地址/;
  const paraRe = /<p>([\s\S]*?)<\/p>/g;
  let p;
  while ((p = paraRe.exec(contentScope))) {
    const block = p[1];
    if (/<div class="dplayer"/.test(block)) continue;
    if (/<img\b/.test(block)) {
      const imgRe = /<img[^>]*data-xkrkllgl="([^"]+)"[^>]*alt="([^"]*)"/g;
      let im;
      while ((im = imgRe.exec(block))) {
        if (im[1] && !/^data:/.test(im[1])) images.push({ imageUrl: im[1], alt: im[2] });
      }
      continue;
    }
    const text = stripTags(block).replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (promoRe.test(text)) break;
    textBlocks.push(text);
  }

  const videos = [];
  const dpRe = /<div class="dplayer"([\s\S]*?)<\/div>/g;
  let d;
  while ((d = dpRe.exec(html))) {
    const attrs = d[1];
    const idMatch = attrs.match(/data-video_id="([^"]+)"/);
    if (!idMatch) continue;
    const cfgMatch = attrs.match(/data-config='([\s\S]*?)'/);
    let playUrl = '';
    if (cfgMatch) {
      try {
        const config = JSON.parse(cfgMatch[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"'));
        const raw = String(config?.video?.url || config?.video_h265?.url || '');
        if (/\.m3u8([?#]|$)/i.test(raw)) {
          playUrl = '/api/mr/play?url=' + encodeURIComponent(raw);
        } else {
          playUrl = raw;
        }
      } catch {
        // ignore
      }
    }
    if (!playUrl) continue;
    const tagNames = (attrs.match(/data-video_tag_name="([^"]*)"/) || [])[1] || '';
    videos.push({
      id: idMatch[1],
      title: (attrs.match(/data-video_title="([^"]*)"/) || [])[1] || title,
      typeName: (attrs.match(/data-video_type_name="([^"]*)"/) || [])[1] || '',
      tags: tagNames.split(',').map((x) => x.trim()).filter(Boolean),
      playUrl,
    });
  }

  return {
    id,
    title,
    author,
    dateText,
    categories,
    description: textBlocks.slice(0, 6).join('\n') || null,
    textBlocks,
    images,
    videos,
    coverUrl: cover,
  };
}

async function posts(site, url, h) {
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const cat = (url.searchParams.get('feed') || '').trim();
  const q = (url.searchParams.get('q') || '').trim();
  let upstream;
  if (q) {
    upstream = UPSTREAM + '/search/' + encodeURIComponent(q) + (page > 1 ? `/${page}/` : '/');
  } else if (cat && cat !== 'home') {
    upstream = UPSTREAM + '/category/' + encodeURIComponent(cat) + (page > 1 ? `/${page}/` : '/');
  } else {
    upstream = UPSTREAM + (page > 1 ? `/page/${page}/` : '/');
  }
  const html = await h.upstream(site, upstream);
  const list = parseCards(html);
  const totalPages = parseTotalPages(html);
  return h.json({ ok: true, page, totalPages, posts: list });
}

async function post(site, url, h) {
  const segments = url.pathname.split('/').filter(Boolean);
  const id = decodeURIComponent(segments[segments.length - 1] || '');
  if (!/^\d+$/.test(id)) return h.json({ ok: false, error: '请求参数无效' }, 400);
  const html = await h.upstream(site, `${UPSTREAM}/archives/${id}/`);
  const detail = parseDetail(html, id);
  if (!detail.title && !detail.videos.length) return h.json({ ok: false, error: '内容不存在' }, 404);
  const first = detail.videos[0] || null;
  return h.json({
    ok: true,
    post: {
      ...detail,
      playUrl: first ? first.playUrl : null,
    },
  }, 200, 'no-store');
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
  let res;
  try {
    res = await fetch(target.toString(), { headers: { 'User-Agent': h.ua, Referer: UPSTREAM + '/' } });
  } catch {
    return h.json({ ok: false, error: '上游不可达' }, 502);
  }
  if (!res.ok) return h.json({ ok: false, error: '上游 ' + res.status }, 502);
  const ct = res.headers.get('Content-Type') || '';
  if (!/mpegurl|hls/i.test(ct)) {
    return new Response(res.body, {
      status: 200,
      headers: {
        'Content-Type': ct || 'application/octet-stream',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  }
  let text;
  try {
    text = await res.text();
  } catch {
    return h.json({ ok: false, error: '读取失败' }, 502);
  }
  const lines = text.split(/\r?\n/).map((line) => {
    if (!line || line.startsWith('#')) {
      const keyM = line.match(/^#EXT-X-KEY:[^"]*URI="([^"]+)"/);
      if (keyM) {
        const abs = new URL(keyM[1], target).toString();
        return line.replace(keyM[1], '/api/mr/play?url=' + encodeURIComponent(abs));
      }
      return line;
    }
    const abs = new URL(line, target).toString();
    return '/api/mr/play?url=' + encodeURIComponent(abs);
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

export { posts, post, play };
