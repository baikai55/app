'use strict';

import * as dom from './dom.js';

const MEDIA_URL_RE = /https?:\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>\\]*)?/gi;
const DURATION_RE = /\b(?:\d{1,2}:)?\d{1,2}:\d{2}\b/;
const DECODE_MAP = [
  [/\\\//g, '/'],
  [/\\u0026/gi, '&'],
  [/\\u003d/gi, '='],
  [/\\x26/gi, '&'],
  [/&amp;/gi, '&'],
  [/&#x2F;/gi, '/'],
];

function decodeEscapedUrl(value) {
  let out = String(value);
  for (const [re, to] of DECODE_MAP) out = out.replace(re, to);
  return out;
}

function cleanText(value) {
  if (!value) return null;
  const cleaned = String(value).replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, 240) : null;
}

function isExpectedHost(host, baseHost) {
  return host === baseHost || host.endsWith('.' + baseHost);
}

function resolveHttpsUrl(value, baseUrl) {
  return dom.resolveUrl(value, baseUrl);
}

function findStat(text, label) {
  const m = new RegExp(`${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[：:]?\\s*([0-9,.万亿]+)`).exec(text);
  return m ? m[1] : null;
}

function normalizeMediaUrl(value, baseUrl) {
  const cleaned = decodeEscapedUrl(value).trim().replace(/^["']+|["',;)\]}]+$/g, '');
  const url = resolveHttpsUrl(cleaned, baseUrl);
  if (!url) return null;
  const path = new URL(url).pathname.toLowerCase();
  return path.endsWith('.m3u8') || path.endsWith('.mp4') ? url : null;
}

function mediaUrlsFromHtml(rawHtml, detailUrl) {
  const values = [];
  const normalized = decodeEscapedUrl(rawHtml);
  for (const m of normalized.matchAll(MEDIA_URL_RE)) values.push(m[0]);
  const results = [];
  for (const value of values) {
    const decoded = decodeEscapedUrl(value);
    const embedded = [...decoded.matchAll(MEDIA_URL_RE)].map((m) => m[0]);
    const candidates = embedded.length ? embedded : [decoded];
    for (const candidate of candidates) {
      const normalizedUrl = normalizeMediaUrl(candidate, detailUrl);
      if (normalizedUrl) results.push(normalizedUrl);
    }
  }
  results.sort((a, b) => {
    const am = /\.m3u8($|\?)/i.test(a.split('?')[0]);
    const bm = /\.m3u8($|\?)/i.test(b.split('?')[0]);
    return am === bm ? 0 : am ? -1 : 1;
  });
  return results;
}

function findMediaUrl(document, rawHtml, detailUrl, selectorOrder) {
  const candidates = [];
  for (const selector of ['[data-url*=m3u8]', '[data-src*=m3u8]', '[data-config]', 'video[data-src]', 'video[src]', 'source[src]', '#player[data-src]', '#player[src]', '#video-play[data-src]']) {
    for (const el of dom.selectAll(document, selector)) {
      for (const attr of ['data-src', 'src', 'data-url', 'data-config', 'content']) {
        const value = dom.attr(el, attr);
        if (value) candidates.push(value);
      }
    }
  }
  const results = [];
  for (const value of candidates) {
    const decoded = decodeEscapedUrl(value);
    const embedded = [...decoded.matchAll(MEDIA_URL_RE)].map((m) => m[0]);
    const pool = embedded.length ? embedded : [decoded];
    for (const candidate of pool) {
      const normalizedUrl = normalizeMediaUrl(candidate, detailUrl);
      if (normalizedUrl) results.push(normalizedUrl);
    }
  }
  for (const url of mediaUrlsFromHtml(rawHtml, detailUrl)) results.push(url);
  results.sort((a, b) => {
    const am = /\.m3u8($|\?)/i.test(a.split('?')[0]);
    const bm = /\.m3u8($|\?)/i.test(b.split('?')[0]);
    return am === bm ? 0 : am ? -1 : 1;
  });
  return results[0] || null;
}

function findPageTitle(document) {
  const direct = dom.attr(dom.selectOne(document, '[data-video_title]'), 'data-video_title');
  if (cleanText(direct)) return cleanText(direct);
  const og = cleanText(dom.attr(dom.selectOne(document, 'meta[property=og:title][content]'), 'content'));
  if (og) return og.split(' | ')[0].split(' - ')[0] || og;
  for (const selector of ['h1', 'h4.container-title', '.post-title', '.entry-title', '.video-title']) {
    const title = cleanText(dom.textContent(dom.selectOne(document, selector)));
    if (title) return title.split(' - ')[0] || title;
  }
  const docTitle = cleanText(dom.textContent(dom.selectOne(document, 'title')));
  if (docTitle) {
    return (docTitle.split(' | ')[0].split(' - ')[0]) || docTitle;
  }
  return null;
}

function findPosterUrl(document, baseUrl) {
  const values = [
    dom.attr(dom.selectOne(document, 'video[poster]'), 'poster'),
    dom.attr(dom.selectOne(document, '[data-poster]'), 'data-poster'),
    dom.attr(dom.selectOne(document, 'meta[property=og:image][content]'), 'content'),
    dom.attr(dom.selectOne(document, 'meta[itemprop=thumbnailUrl][content]'), 'content'),
  ];
  for (const value of values) {
    if (!value) continue;
    const url = resolveHttpsUrl(value, baseUrl);
    if (url) return url;
  }
  return null;
}

function findDuration(document, pageText) {
  const meta = cleanText(dom.attr(dom.selectOne(document, 'meta[itemprop=duration][content]'), 'content'));
  if (meta) return meta;
  const m = DURATION_RE.exec(pageText);
  return m ? m[0] : null;
}

function findAuthor(document) {
  for (const selector of ['[itemprop=author]', '#videoShowTabAbout a[href*=/author/]', 'a[href*=/author/]']) {
    const author = cleanText(dom.textContent(dom.selectOne(document, selector)));
    if (author) return author;
  }
  return null;
}

function parseVideoDetails(siteConfig, html, detailUrl) {
  const document = dom.parse(html);
  const mediaUrl = findMediaUrl(document, html, detailUrl);
  if (!mediaUrl) return null;
  const pageText = cleanText(dom.textContent(document.body || document)) || '';
  return {
    title: findPageTitle(document) || '视频',
    playUrl: mediaUrl,
    isHls: /\.m3u8($|\?)/i.test(mediaUrl.split('?')[0]),
    posterUrl: findPosterUrl(document, detailUrl),
    duration: findDuration(document, pageText),
    author: findAuthor(document),
    views: findStat(pageText, '播放') || findStat(pageText, '热度'),
    favorites: findStat(pageText, '收藏'),
    dateText: null,
  };
}

const CARD_CONTAINER_SELECTOR = 'article, li, .card, .video-item, .vod-item, .post-item, .item, .col';
const TITLE_SELECTOR = '.video-title, .title, h2, h3, h4';
const THUMB_ATTRS = ['data-original', 'data-lazy-src', 'data-src', 'src'];

function findCardTitle(link, container, canUseContainerEvidence) {
  const values = [];
  const push = (v) => { if (v) values.push(v); };
  push(dom.attr(link, 'title'));
  push(cleanText(dom.textContent(dom.selectOne(link, TITLE_SELECTOR))));
  push(dom.attr(dom.selectOne(link, 'img'), 'alt'));
  push(cleanText(dom.textContent(link)));
  if (canUseContainerEvidence) {
    push(cleanText(dom.textContent(dom.selectOne(container, TITLE_SELECTOR))));
  }
  for (const value of values) {
    const cleaned = cleanText(value);
    if (cleaned && cleaned.length >= 2 && !['play', '播放', '详情', 'more'].includes(cleaned.toLowerCase())) {
      return cleaned;
    }
  }
  return null;
}

function findThumbnailUrl(link, container, baseUrl, canUseContainerEvidence) {
  const image = dom.selectOne(link, 'img') || (canUseContainerEvidence ? dom.selectOne(container, 'img') : null);
  if (image) {
    for (const attrName of THUMB_ATTRS) {
      const value = dom.attr(image, attrName);
      const url = resolveHttpsUrl(value, baseUrl);
      if (url) return url;
    }
  }
  if (!canUseContainerEvidence) return null;
  const scriptText = dom.selectAll(container, 'script').map((s) => s.children.map((c) => c.text || '').join('')).join('\n');
  const m = /loadBannerDirect\(\s*['"]([^'"]+)['"]/i.exec(scriptText);
  if (m) return resolveHttpsUrl(m[1], baseUrl);
  return null;
}

function findCardAuthor(container) {
  for (const selector of ['.author', '[rel=author]', 'a[href*=/author/]']) {
    const author = cleanText(dom.textContent(dom.selectOne(container, selector)));
    if (author) return author;
  }
  return null;
}

function extractContentId(siteConfig, urlString) {
  const rule = siteConfig.contentId;
  if (!rule) return null;
  let url;
  try {
    url = new URL(urlString);
  } catch {
    return null;
  }
  const segments = url.pathname.split('/').filter(Boolean);
  if (rule.type === 'path') {
    const idx = segments.indexOf(rule.marker);
    if (idx < 0) return null;
    const value = segments[idx + rule.offset];
    return value && rule.pattern && !new RegExp(rule.pattern).test(value) ? null : value || null;
  }
  if (rule.type === 'regex') {
    const m = new RegExp(rule.pattern).exec(urlString);
    return m ? m[1] : null;
  }
  if (rule.type === 'query') {
    const value = url.searchParams.get(rule.key);
    return value && rule.pattern && !new RegExp(rule.pattern).test(value) ? null : value || null;
  }
  return null;
}

function parseVideoList(siteConfig, html, baseUrl) {
  const document = dom.parse(html);
  dom.removeAll(document, '#search-history, .search-history');
  let baseHost;
  try {
    baseHost = new URL(baseUrl).host;
  } catch {
    return [];
  }
  const candidates = new Map();
  for (const link of dom.selectAll(document, 'a[href]')) {
    const hrefValue = dom.href(link);
    if (!hrefValue) continue;
    const detailUrl = dom.resolveUrl(hrefValue, baseUrl);
    if (!detailUrl) continue;
    let detailHost;
    try {
      detailHost = new URL(detailUrl).host;
    } catch {
      continue;
    }
    if (!isExpectedHost(detailHost, baseHost)) continue;
    const contentId = extractContentId(siteConfig, detailUrl);
    if (!contentId) continue;
    const container = dom.selectOne(link, CARD_CONTAINER_SELECTOR) || link;
    const canUseContainerEvidence = (() => {
      let hasCurrent = false;
      for (const candidateLink of dom.selectAll(container, 'a[href]')) {
        const candidateUrl = dom.resolveUrl(dom.href(candidateLink), baseUrl);
        if (!candidateUrl) continue;
        let candidateHost;
        try {
          candidateHost = new URL(candidateUrl).host;
        } catch {
          return false;
        }
        if (!isExpectedHost(candidateHost, baseHost)) return false;
        const candidateId = extractContentId(siteConfig, candidateUrl);
        if (!candidateId) continue;
        if (candidateId !== contentId) return false;
        hasCurrent = true;
      }
      return hasCurrent;
    })();
    const metadataRoot = canUseContainerEvidence ? container : link;
    const title = siteConfig.requirePostTitle && container
      ? cleanText(dom.textContent(dom.selectOne(container, siteConfig.requirePostTitle))) || null
      : findCardTitle(link, container, canUseContainerEvidence);
    if (!title) continue;
    const thumbnailUrl = findThumbnailUrl(link, container, baseUrl, canUseContainerEvidence);
    const cardText = cleanText(dom.textContent(metadataRoot)) || '';
    const score = (thumbnailUrl ? 4 : 0) + Math.min(title.length, 80);
    const existing = candidates.get(contentId);
    if (!existing || score > existing.score) {
      candidates.set(contentId, {
        id: contentId,
        title,
        coverUrl: thumbnailUrl,
        duration: (DURATION_RE.exec(cardText) || [])[0] || null,
        author: findCardAuthor(metadataRoot),
        views: findStat(cardText, '播放') || findStat(cardText, '观看') || null,
        isHd: /\bHD\b|高清/i.test(cardText) || undefined,
      });
    }
  }
  return [...candidates.values()];
}

function pageText(document) {
  return cleanText(dom.textContent(document)) || '';
}

export { parseVideoList, parseVideoDetails, findMediaUrl, mediaUrlsFromHtml, extractContentId, findPageTitle, findPosterUrl, findDuration, findAuthor, findStat, cleanText, decodeEscapedUrl, resolveHttpsUrl, pageText, DURATION_RE };



