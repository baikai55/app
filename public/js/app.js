(() => {
  'use strict';

  const app = document.getElementById('app');
  const quickNav = document.getElementById('quickNav');
  const drawer = document.getElementById('drawer');
  const drawerMask = document.getElementById('drawerMask');
  const menuBtn = document.getElementById('menuBtn');
  const drawerClose = document.getElementById('drawerClose');
  const catNav = document.getElementById('catNav');
  const rankNav = document.getElementById('rankNav');

  const state = {
    navData: { sites: [], categories: [] },
    route: null,
    controller: null,
    navController: null,
    version: 0,
    canceledVersion: 0,
    currentDetail: null,
    hls: null,
    art: null,
    mediaEvents: null,
    playerController: null,
    playerRecoveryUsed: false,
    playerTimer: null,
  };

  const esc = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const publicImage = (value) => {
    const url = String(value || '');
    if (/^\/api\/[a-z0-9-]+\/(image|cover|proxy)\b/.test(url)) return url;
    if (/^https:\/\/(?:bmc\d*\.imgclh\.com)\/[^"'\s]+$/.test(url)) return `/api/cover?url=${encodeURIComponent(url)}`;
    if (/^https:\/\/(?:pic\.xmbvxj\.cn|expose\.eisees\.com|v\.rn\d+\.xyz|pics\.pornfhd\.com|media\.cfnav\.com|statbv?\.avstatic\.com|img\.cdn202511\.com|video\.18j2026\.com|cloud-\d+\.vdcdn\.xyz|pic\.xustgq\.cn|madou\.casa)\/[^"'\s]+$/.test(url)) return url;
    if (/^data:image\//.test(url)) return url;
    return '';
  };

  async function request(url, { signal, method = 'GET' } = {}) {
    let response;
    try {
      response = await fetch(url, {
        method,
        signal,
        headers: { Accept: 'application/json' },
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      const networkError = new Error('网络连接异常，请稍后重试');
      networkError.status = 0;
      throw networkError;
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(
        payload?.error || (response.status >= 500 ? '服务暂时不可用' : '内容暂时无法加载'),
      );
      error.status = response.status;
      throw error;
    }
    return payload || {};
  }

  function parseHash() {
    const raw = (location.hash.replace(/^#/, '') || '/');
    const separator = raw.indexOf('?');
    const rawPath = separator >= 0 ? raw.slice(0, separator) : raw;
    const query = new URLSearchParams(separator >= 0 ? raw.slice(separator + 1) : '');
    let path;
    try {
      path = decodeURIComponent(rawPath || '/');
    } catch {
      path = '/';
    }
    const segments = path.split('/').filter(Boolean);
    const siteId = segments[0] && /^[a-z0-9-]+$/.test(segments[0]) ? segments[0] : 'ja';
    const rest = segments.slice(1);
    if (path === '/' || rest.length === 0) return { name: 'home', siteId, page: Math.max(1, Number(query.get('page')) || 1) };
    if (rest[0] === 'category' && rest[1]) return {
      name: 'category',
      siteId,
      feedId: rest[1],
      page: Math.max(1, Number(query.get('page')) || 1),
    };
    if (rest[0] === 'v' && rest[1]) return { name: 'detail', siteId, id: rest.slice(1).join('/') };
    return { name: 'home', siteId, page: 1 };
  }

  function linkTo(route) {
    const base = `#/${encodeURIComponent(route.siteId || 'ja')}`;
    if (route.name === 'home') return route.page > 1 ? `${base}/?page=${route.page}` : `${base}/`;
    if (route.name === 'category') {
      const cat = `${base}/category/${encodeURIComponent(route.feedId)}`;
      return route.page > 1 ? `${cat}?page=${route.page}` : cat;
    }
    if (route.name === 'detail') return `${base}/v/${encodeURIComponent(route.id)}`;
    return `${base}/`;
  }

  function setDrawer(open) {
    drawer.classList.toggle('open', open);
    drawer.setAttribute('aria-hidden', open ? 'false' : 'true');
    drawerMask.hidden = !open;
    document.body.classList.toggle('drawer-open', open);
  }

  function destroyPlayer({ abortRequest = true } = {}) {
    window.clearTimeout(state.playerTimer);
    state.playerTimer = null;
    state.mediaEvents?.abort();
    state.mediaEvents = null;
    if (abortRequest) state.playerController?.abort();
    state.playerController = null;
    if (state.hls) {
      try { state.hls.destroy(); } catch {}
      state.hls = null;
    }
    if (state.art) {
      try { state.art.destroy(true); } catch {}
      state.art = null;
    }
    state.playerRecoveryUsed = false;
  }

  function skeletonGrid(count = 12) {
    return `<section class="content-grid skeleton-grid" aria-hidden="true">${Array.from({ length: count }, () => `
      <div class="skeleton-card"><div class="skeleton-media"></div><div class="skeleton-line"></div><div class="skeleton-line short"></div></div>`).join('')}</section>`;
  }

  function loadingState(message = '加载中') {
    return `<div class="inline-state loading-state"><span class="loader" aria-hidden="true"></span><span>${esc(message)}</span><button type="button" class="button" data-cancel-route>取消</button></div>`;
  }

  function emptyState(message) {
    return `<div class="empty-state"><strong>暂无内容</strong><span>${esc(message || '换一个条件试试')}</span></div>`;
  }

  function errorState(message, { title = '暂时无法加载', back = false } = {}) {
    return `<div class="error-state"><strong>${esc(title)}</strong><span>${esc(message || '请稍后重试')}</span>
      <div class="state-actions"><button type="button" class="button primary" data-retry-route>重试</button>${back ? '<button type="button" class="button" data-detail-back>返回列表</button>' : ''}</div>
    </div>`;
  }

  function imageMarkup(url, fallback = '封面不可用') {
    const source = publicImage(url);
    return `${source ? `<img src="${esc(source)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ''}<span class="image-fallback">${esc(fallback)}</span>`;
  }

  function wireImages(root = app) {
    root.querySelectorAll('[data-image-frame]').forEach((frame) => {
      const image = frame.querySelector('img');
      const loaded = () => { frame.classList.add('loaded'); frame.classList.remove('failed'); };
      const failed = () => { frame.classList.add('failed'); frame.classList.remove('loaded'); };
      if (!image) return failed();
      if (image.complete) return image.naturalWidth > 0 ? loaded() : failed();
      image.addEventListener('load', loaded, { once: true });
      image.addEventListener('error', failed, { once: true });
    });
  }

  function cardHTML(item, siteId) {
    const href = linkTo({ name: 'detail', siteId, id: item.id });
    const meta = [item.duration, item.views != null ? `${item.views} 次` : ''].filter(Boolean).join(' · ');
    return `<a class="content-card" href="${esc(href)}" data-link>
      <div class="card-media" data-image-frame>${imageMarkup(item.coverUrl)}<span class="card-play" aria-hidden="true">▶</span></div>
      <h2 class="card-title">${esc(item.title || '未命名内容')}</h2>
      <div class="card-meta"><span>${esc(meta)}</span></div>
    </a>`;
  }

  function currentSite() {
    return state.navData.sites.find((s) => s.id === state.route?.siteId) || state.navData.sites[0] || { id: 'ja', name: '看聚合', feeds: [] };
  }

  function quickNavHTML(activeSiteId) {
    const sites = state.navData.sites;
    if (!sites.length) return '';
    return `<nav class="quick-categories" aria-label="站点导航">${sites.map((site) => `
      <a class="nav-item${site.id === activeSiteId ? ' active' : ''}" href="#/${encodeURIComponent(site.id)}/" data-link>${esc(site.name)}</a>`).join('')}</nav>`;
  }

  function feedNavHTML(site, activeFeedId) {
    const feeds = site?.feeds || [];
    if (!feeds.length) return '';
    return `<nav class="quick-categories" aria-label="频道分类">${feeds.map((feed) => `
      <a class="nav-item${feed.id === activeFeedId ? ' active' : ''}" href="#/${encodeURIComponent(site.id)}/category/${encodeURIComponent(feed.id)}" data-link>${esc(feed.name)}</a>`).join('')}</nav>`;
  }

  function renderNav() {
    const route = state.route || parseHash();
    rankNav.innerHTML = `<a class="chip" href="#/${encodeURIComponent(route.siteId || 'ja')}/" data-link>首页</a>`;
    quickNav.innerHTML = quickNavHTML(route.siteId);
    const site = state.navData.sites.find((s) => s.id === route.siteId);
    catNav.innerHTML = (site?.feeds || []).map((feed) => `<a href="#/${encodeURIComponent(site.id)}/category/${encodeURIComponent(feed.id)}" data-link>${esc(feed.name)}</a>`).join('');
  }

  async function loadNav() {
    state.navController?.abort();
    state.navController = new AbortController();
    try {
      const data = await request('/api/meta', { signal: state.navController.signal });
      state.navData = {
        sites: Array.isArray(data.sites) ? data.sites : [],
        categories: Array.isArray(data.categories) ? data.categories : [],
      };
    } catch (error) {
      if (error?.name !== 'AbortError') {
        state.navData = { sites: [], categories: [] };
      }
    } finally {
      renderNav();
    }
  }

  function pagerHTML(route, page, totalPages, hasNext) {
    const previous = page > 1 ? page - 1 : 0;
    const next = (totalPages ? totalPages > page : hasNext) ? page + 1 : 0;
    return `<nav class="pager" aria-label="分页"><a class="button${previous ? '' : ' disabled'}" href="${esc(previous ? linkTo({ ...route, page: previous }) : '#')}" data-link ${previous ? '' : 'aria-disabled="true"'}>上一页</a><span>${page} 页${totalPages ? ` / ${totalPages} 页` : ''}</span><a class="button${next ? '' : ' disabled'}" href="${esc(next ? linkTo({ ...route, page: next }) : '#')}" data-link ${next ? '' : 'aria-disabled="true"'}>下一页</a></nav>`;
  }

  async function renderList(route, signal, version) {
    const site = state.navData.sites.find((s) => s.id === route.siteId);
    const feed = route.name === 'category' ? site?.feeds?.find((f) => f.id === route.feedId) : null;
    const title = route.name === 'category' ? (feed?.name || route.feedId) : (site?.name || route.siteId);
    document.title = `${title} · 看聚合`;
    app.innerHTML = `<header class="page-head"><div><h1>${esc(title)}</h1><span class="page-meta">浏览目录</span></div></header>${feedNavHTML(site, feed?.id)}${skeletonGrid()}${loadingState()}`;
    const params = new URLSearchParams({ page: String(route.page || 1) });
    if (feed) params.set('feed', feed.id);
    try {
      const data = await request(`/api/${encodeURIComponent(route.siteId)}/posts?${params}`, { signal });
      if (version !== state.version || signal.aborted) return;
      const items = Array.isArray(data.posts) ? data.posts : [];
      const page = Number(data.page || route.page || 1);
      const totalPages = Number(data.totalPages) || 0;
      const hasNext = !!data.hasNext;
      const heading = `<header class="page-head"><div><h1>${esc(title)}</h1><span class="page-meta">第 ${page} 页 · ${items.length} 条</span></div></header>`;
      app.innerHTML = `${heading}${feedNavHTML(site, feed?.id)}${items.length ? `<section class="content-grid">${items.map((item) => cardHTML(item, route.siteId)).join('')}</section>${pagerHTML(route, page, totalPages, hasNext)}` : emptyState('没有找到相关内容')}`;
      wireImages();
      window.scrollTo({ top: 0, behavior: 'auto' });
    } catch (error) {
      if (error?.name === 'AbortError' || version !== state.version || state.canceledVersion === version) return;
      app.innerHTML = errorState(error.message || '列表暂时不可用');
    }
  }

  function detailSkeleton() {
    return `<button type="button" class="button back-button" data-detail-back>← 返回</button><div class="detail-layout"><section class="detail-main"><div class="player-shell player-skeleton"><div class="skeleton-media"></div></div><div class="detail-copy"><div class="skeleton-line"></div><div class="skeleton-line short"></div></div></section></div>`;
  }

  function playerHTML() {
    return `<div class="player-shell"><div class="art-player" id="art-player"></div><div class="player-feedback" id="playerFeedback"><div class="feedback-label"><span class="loader" aria-hidden="true"></span><span>正在加载</span><button type="button" class="button" data-player-cancel>取消</button></div></div></div>`;
  }

  function playerFeedback(message, mode = 'loading') {
    const box = document.getElementById('playerFeedback');
    if (!box) return;
    if (!message) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }
    box.hidden = false;
    box.innerHTML = mode === 'error'
      ? `<div class="feedback-label error-label"><span>${esc(message)}</span><button type="button" class="button" data-player-retry>重试</button></div>`
      : `<div class="feedback-label"><span class="loader" aria-hidden="true"></span><span>${esc(message)}</span><button type="button" class="button" data-player-cancel>取消</button></div>`;
  }

  function attachHls(video, url, art) {
    if (!window.Hls || !window.Hls.isSupported()) {
      if (video.canPlayType('application/vnd.apple.mpegurl')) video.src = url;
      else throw new Error('当前浏览器不支持 HLS 播放');
      return;
    }
    const hls = new window.Hls({
      enableWorker: false,
      lowLatencyMode: false,
      maxBufferLength: 24,
      maxMaxBufferLength: 48,
      backBufferLength: 30,
      manifestLoadingTimeOut: 12_000,
      levelLoadingTimeOut: 12_000,
      fragLoadingTimeOut: 20_000,
    });
    state.hls = hls;
    hls.on(window.Hls.Events.MEDIA_ATTACHED, () => {
      if (state.hls === hls) hls.loadSource(url);
    });
    hls.on(window.Hls.Events.MANIFEST_PARSED, () => playerFeedback(''));
    hls.on(window.Hls.Events.ERROR, (_event, data) => {
      if (!data?.fatal) return;
      if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR && !state.playerRecoveryUsed) {
        state.playerRecoveryUsed = true;
        playerFeedback('网络波动，正在重连');
        hls.startLoad();
        return;
      }
      playerFeedback('播放失败，请重试', 'error');
    });
    art.on('destroy', () => {
      if (state.hls === hls) state.hls = null;
      try { hls.destroy(); } catch {}
    });
    hls.attachMedia(video);
  }

  async function attachPlayer(playUrl, poster) {
    destroyPlayer();
    if (!playUrl) {
      playerFeedback('播放地址暂时不可用', 'error');
      return;
    }
    const controller = new AbortController();
    state.playerController = controller;
    playerFeedback('正在准备播放');
    try {
      const image = publicImage(poster);
      if (!window.Artplayer) throw new Error('播放器加载失败，请刷新页面');
      const isHls = playUrl.includes('/api/') || /\.m3u8($|\?)/i.test(playUrl);
      const art = new window.Artplayer({
        container: '#art-player',
        url: playUrl,
        type: isHls ? 'm3u8' : 'mp4',
        poster: image || '',
        autoplay: false,
        autoPlayback: false,
        volume: .8,
        theme: '#d6dadd',
        hotkey: true,
        pip: true,
        mutex: true,
        setting: true,
        playbackRate: true,
        fullscreen: true,
        fullscreenWeb: true,
        miniProgressBar: true,
        lock: true,
        gesture: true,
        playsInline: true,
        moreVideoAttr: { preload: 'metadata', playsInline: true },
        customType: { m3u8: attachHls },
      });
      state.art = art;
      const video = art.video;
      const artContainer = document.querySelector('#art-player');
      if (artContainer) {
        const isControl = (e) => !!(e.target && e.target.closest && e.target.closest('.art-icon, .art-control, .art-contextmenu, .art-settings, .art-selector'));
        artContainer.addEventListener('click', (e) => {
          if (isControl(e)) return;
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
        }, { capture: true });
        const isTouchDevice = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
        const togglePlay = () => { if (video.paused) video.play().catch(() => {}); else video.pause(); };
        if (!isTouchDevice) {
          artContainer.addEventListener('dblclick', (e) => {
            if (isControl(e)) return;
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            togglePlay();
          }, { capture: true });
        } else {
          let lastTap = 0;
          let tapHandled = false;
          artContainer.addEventListener('touchend', (e) => {
            if (isControl(e)) return;
            const now = Date.now();
            if (now - lastTap < 350) {
              lastTap = 0;
              if (tapHandled) { tapHandled = false; return; }
              tapHandled = true;
              togglePlay();
            } else {
              lastTap = now;
              tapHandled = false;
            }
          }, { capture: true });
        }
      }
      const ready = () => {
        window.clearTimeout(state.playerTimer);
        state.playerTimer = null;
        playerFeedback('');
      };
      state.mediaEvents = new AbortController();
      const options = { signal: state.mediaEvents.signal };
      video.addEventListener('loadstart', () => playerFeedback('正在加载'), options);
      video.addEventListener('loadedmetadata', ready, options);
      video.addEventListener('canplay', ready, options);
      video.addEventListener('playing', ready, options);
      video.addEventListener('waiting', () => {
        playerFeedback('正在缓冲');
        window.clearTimeout(state.playerTimer);
        state.playerTimer = window.setTimeout(() => {
          if (video.readyState < 3) playerFeedback('等待时间较长，请重试', 'error');
        }, 18_000);
      }, options);
      video.addEventListener('seeking', () => playerFeedback('正在定位'), options);
      video.addEventListener('seeked', ready, options);
      video.addEventListener('error', () => {
        if (!state.hls) playerFeedback('播放失败，请重试', 'error');
      }, options);
      art.on('ready', ready);
      if (video.readyState >= 3) ready();
    } catch (error) {
      if (error?.name === 'AbortError') return;
      destroyPlayer({ abortRequest: false });
      playerFeedback(error.message || '播放地址暂时不可用', 'error');
    }
  }

  async function renderDetail(route, signal, version) {
    destroyPlayer();
    document.title = '加载中 · 看聚合';
    app.innerHTML = detailSkeleton();
    try {
      const data = await request(`/api/${encodeURIComponent(route.siteId)}/post/${encodeURIComponent(route.id)}`, { signal });
      if (version !== state.version || signal.aborted) return;
      const post = data.post || {};
      state.currentDetail = { route, post };
      document.title = `${post.title || '详情'} · 看聚合`;
      const metaParts = [];
      if (post.views != null) metaParts.push(`${post.views} 次播放`);
      if (post.duration) metaParts.push(post.duration);
      if (post.author) metaParts.push(post.author);
      if (post.dateText) metaParts.push(post.dateText);
      const meta = metaParts.join(' · ');
      const tags = (post.tags || []).map((tag) => `<span class="tag">${esc(tag)}</span>`).join('');
      app.innerHTML = `<button type="button" class="button back-button" data-detail-back>← 返回</button><div class="detail-layout"><section class="detail-main">
        ${post.playUrl ? playerHTML() : '<div class="player-shell"><div class="detail-unavailable">未找到可用播放器</div></div>'}
        <div class="detail-copy">
          <h1>${esc(post.title || '未命名内容')}</h1>
          <div class="detail-meta">${meta ? `<span>${esc(meta)}</span>` : ''}</div>
          ${tags ? `<div class="tag-list">${tags}</div>` : ''}
          <div class="detail-actions">${post.playUrl ? '<button type="button" class="button primary" data-player-retry>重新加载播放</button>' : ''}</div>
        </div>
        ${post.description ? `<section class="detail-body"><p>${esc(post.description)}</p></section>` : ''}
      </section></div>`;
      wireImages();
      window.scrollTo({ top: 0, behavior: 'auto' });
      if (post.playUrl) await attachPlayer(post.playUrl, post.coverUrl);
    } catch (error) {
      if (error?.name === 'AbortError' || version !== state.version || state.canceledVersion === version) return;
      app.innerHTML = `<button type="button" class="button back-button" data-detail-back>← 返回</button>${errorState(error.message || '详情暂时不可用')}`;
    }
  }

  function cancelCurrentRequest() {
    if (!state.controller) return;
    state.canceledVersion = state.version;
    state.controller.abort();
    destroyPlayer();
    app.innerHTML = errorState('已取消当前请求', { title: '加载已取消' });
  }

  async function route() {
    state.controller?.abort();
    destroyPlayer();
    state.controller = new AbortController();
    state.version += 1;
    state.canceledVersion = 0;
    const version = state.version;
    const next = parseHash();
    state.route = next;
    renderNav();
    if (next.name === 'home') return renderList(next, state.controller.signal, version);
    if (next.name === 'category') return renderList(next, state.controller.signal, version);
    if (next.name === 'detail') return renderDetail(next, state.controller.signal, version);
    return renderList({ name: 'home', siteId: next.siteId, page: 1 }, state.controller.signal, version);
  }

  menuBtn.addEventListener('click', () => setDrawer(true));
  drawerClose.addEventListener('click', () => setDrawer(false));
  drawerMask.addEventListener('click', () => setDrawer(false));

  document.addEventListener('click', (event) => {
    const cancel = event.target.closest('[data-cancel-route]');
    if (cancel) {
      event.preventDefault();
      cancelCurrentRequest();
      return;
    }
    if (event.target.closest('[data-retry-route]')) {
      event.preventDefault();
      route();
      return;
    }
    if (event.target.closest('[data-detail-back]')) {
      event.preventDefault();
      history.length > 1 ? history.back() : (location.hash = linkTo({ name: 'home', siteId: state.route?.siteId || 'ja', page: 1 }));
      return;
    }
    if (event.target.closest('[data-player-cancel]')) {
      event.preventDefault();
      state.playerController?.abort();
      playerFeedback('已取消播放解析', 'error');
      return;
    }
    if (event.target.closest('[data-player-retry]') && state.currentDetail?.post?.playUrl) {
      event.preventDefault();
      attachPlayer(state.currentDetail.post.playUrl, state.currentDetail.post.coverUrl);
    }
    if (event.target.closest('a[data-link]')) setDrawer(false);
  });

  window.addEventListener('hashchange', route);
  renderNav();
  loadNav();
  route();
})();
