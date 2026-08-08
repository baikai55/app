'use strict';

const AVJB_CDN_BASE = 'https://list.avstatic.com/cdn/videos';
const MAX_SEGMENTS = 6000;

function bucketOf(videoId) {
  return Math.floor(Number(videoId) / 1000) * 1000;
}

function segmentUrl(videoId, index) {
  return `${AVJB_CDN_BASE}/${bucketOf(videoId)}/${videoId}/${String(index).padStart(4, '0')}.jpg`;
}

async function segmentExists(ctx, videoId, index) {
  const res = await ctx.fetch(segmentUrl(videoId, index), {
    method: 'HEAD',
    headers: {
      'User-Agent': ctx.ua,
      Referer: ctx.baseUrl,
    },
    redirect: 'follow',
  });
  return res.status >= 200 && res.status < 300;
}

async function resolveSegmentCount(ctx, videoId) {
  if (!(await segmentExists(ctx, videoId, 0))) return null;
  let hi = 1;
  while (hi < MAX_SEGMENTS && (await segmentExists(ctx, videoId, hi))) hi *= 2;
  let lo = Math.floor(hi / 2);
  hi = Math.min(hi, MAX_SEGMENTS);
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (await segmentExists(ctx, videoId, mid)) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

function buildPlaylist(videoId, segmentCount) {
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-TARGETDURATION:2',
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-PLAYLIST-TYPE:VOD',
  ];
  for (let index = 0; index < segmentCount; index++) {
    lines.push('#EXTINF:2.000000,');
    lines.push(segmentUrl(videoId, index));
  }
  lines.push('#EXT-X-ENDLIST');
  return lines.join('\n');
}

module.exports = { resolveSegmentCount, buildPlaylist, segmentUrl };
