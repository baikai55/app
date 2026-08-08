'use strict';

const SITES = [
  {
    id: 'ja',
    name: '看JavBus',
    tagline: 'JavBus 内容浏览入口',
    baseUrl: 'https://avjb.com/',
    encoding: 'gbk',
    contentId: { type: 'path', marker: 'video', offset: 1, pattern: '^\\d+$' },
    feeds: [
      { id: 'home', name: '首页', path: '/', isHome: true },
    ],
    pagination: 'none',
    playback: 'avjb-rebuild',
    proxySegments: false,
  },
  {
    id: '18j',
    name: '看18J',
    tagline: '高清片库，支持多清晰度播放',
    baseUrl: 'https://18j.tv/',
    contentId: { type: 'path', marker: 'v', offset: 1, pattern: '^\\d+$' },
    feeds: [
      { id: 'hot', name: '热门', path: '/label/hot/by/time/' },
      { id: 't-1', name: '国产', path: '/t/1/' },
      { id: 't-2', name: '日韩', path: '/t/2/' },
      { id: 't-3', name: '欧美', path: '/t/3/' },
      { id: 't-4', name: '伦理', path: '/t/4/' },
      { id: 't-5', name: '动漫', path: '/t/5/' },
      { id: 't-6', name: '另类', path: '/t/6/' },
      { id: 't-13', name: '吃瓜黑料', path: '/t/13/' },
      { id: 't-14', name: '国产探花', path: '/t/14/' },
      { id: 't-21', name: 'JAV自拍', path: '/t/21/' },
      { id: 't-22', name: '中文字幕', path: '/t/22/' },
      { id: 't-23', name: 'JAV无码', path: '/t/23/' },
    ],
    pagination: 'path',
    playback: 'direct',
  },
];

function findSite(id) {
  return SITES.find((s) => s.id === id) || null;
}

function publicImageAllowed(url) {
  if (!url) return false;
  if (/^data:image\//.test(url)) return true;
  return /^https:\/\/(?:[a-z0-9.-]+\.)?(?:imgclh\.com|avstatic\.com|cdn202511\.com|18j2026\.com|jb-aiwei\.cc|cfnav\.com|bestjavporn\.com|vdcdn\.xyz|pianopic\.com|streamhls\.click|streamtape\.net|tapecontent\.net|cloudatacdn\.com)(?:[/?#]|$)/i.test(url);
}

module.exports = { SITES, findSite, publicImageAllowed };
