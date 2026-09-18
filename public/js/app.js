(() => {
  'use strict';

  const app = document.getElementById('app');
  const topbar = document.querySelector('.topbar');
  const quickNav = document.getElementById('quickNav');
  const drawer = document.getElementById('drawer');
  const drawerMask = document.getElementById('drawerMask');
  const menuBtn = document.getElementById('menuBtn');
  const drawerClose = document.getElementById('drawerClose');
  const catNav = document.getElementById('catNav');
  const rankNav = document.getElementById('rankNav');
  const routeStatus = document.getElementById('routeStatus');
  const routeAlert = document.getElementById('routeAlert');

  const state = {
    navData: { sites: [], categories: [] },
    route: null,
    controller: null,
    navController: null,
    navReady: false,
    navPromise: null,
    version: 0,
    canceledVersion: 0,
    currentDetail: null,
    hls: null,
    art: null,
    mediaEvents: null,
    playerController: null,
    playerTimer: null,
    playerClickTimer: null,
    playerSession: 0,
    drawerPreviousFocus: null,
    detailReturn: null,
    pendingListRestore: null,
    detailNavigationPending: false,
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
    if (/^https:\/\/(?:pic\.xmbvxj\.cn|expose\.eisees\.com|v\.rn\d+\.xyz|pics\.pornfhd\.com|media\.cfnav\.com|statbv?\.avstatic\.com|img\.cdn20\d{4}\.com|video\.18j2026\.com|cloud-\d+\.vdcdn\.xyz|pic\.xustgq\.cn|madou\.casa)\/[^"'\s]+$/.test(url)) return url;
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

  const focusableSelector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function drawerFocusable() {
    return Array.from(drawer.querySelectorAll(focusableSelector)).filter((element) => element.getClientRects().length > 0);
  }

  function setDrawer(open, { restoreFocus = true } = {}) {
    if (open === drawer.classList.contains('open')) return;
    if (open) {
      state.drawerPreviousFocus = document.activeElement instanceof HTMLElement
        && document.activeElement !== document.body ? document.activeElement : menuBtn;
    }
    drawer.classList.toggle('open', open);
    drawer.setAttribute('aria-hidden', open ? 'false' : 'true');
    drawer.inert = !open;
    drawer.toggleAttribute('inert', !open);
    drawerMask.hidden = !open;
    app.inert = open;
    app.toggleAttribute('inert', open);
    topbar.inert = open;
    topbar.toggleAttribute('inert', open);
    menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    document.body.classList.toggle('drawer-open', open);
    if (open) {
      drawerClose.focus({ preventScroll: true });
    } else {
      const previousFocus = state.drawerPreviousFocus;
      state.drawerPreviousFocus = null;
      if (restoreFocus && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    }
  }

  function announce(message, { error = false } = {}) {
    if (!routeStatus || !routeAlert) return;
    routeStatus.textContent = '';
    routeAlert.textContent = '';
    (error ? routeAlert : routeStatus).textContent = message || '';
  }

  function finishRoute({ message, error = false, focus = null } = {}) {
    app.setAttribute('aria-busy', 'false');
    announce(message, { error });
    const target = focus?.isConnected ? focus : app.querySelector('[data-page-focus]') || app.querySelector('h1') || app;
    target.focus({ preventScroll: true });
  }

  function destroyPlayer({ abortRequest = true } = {}) {
    state.playerSession += 1;
    window.clearTimeout(state.playerTimer);
    window.clearTimeout(state.playerClickTimer);
    state.playerTimer = null;
    state.playerClickTimer = null;
    state.mediaEvents?.abort();
    state.mediaEvents = null;
    if (abortRequest) state.playerController?.abort();
    state.playerController = null;
    const hls = state.hls;
    const art = state.art;
    state.hls = null;
    state.art = null;
    if (hls) {
      try { hls.destroy(); } catch {}
    }
    const video = art?.video;
    if (video) {
      try {
        video.pause();
        video.removeAttribute('src');
        video.load();
      } catch {}
    }
    if (art) try { art.destroy(true); } catch {}
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
    return `<div class="error-state"><h2 tabindex="-1" data-page-focus>${esc(title)}</h2><span>${esc(message || '请稍后重试')}</span>
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
    return `<a class="content-card" href="${esc(href)}" data-link data-item-id="${esc(item.id || '')}">
      <div class="card-media" data-image-frame>${imageMarkup(item.coverUrl)}<span class="card-play" aria-hidden="true">▶</span></div>
      <h2 class="card-title">${esc(item.title || '未命名内容')}</h2>
      <div class="card-meta"><span>${esc(meta)}</span></div>
    </a>`;
  }

  function rememberListView(card) {
    if (!state.route || !['home', 'category'].includes(state.route.name)) return;
    const detailHash = card.getAttribute('href');
    if (!detailHash) return;
    state.detailReturn = {
      hash: location.hash,
      detailHash,
      itemId: card.dataset.itemId || '',
      scrollY: window.scrollY,
    };
    state.detailNavigationPending = true;
  }

  function returnFromDetail() {
    const source = state.detailReturn;
    if (state.pendingListRestore) return;
    if (source && source.detailHash === location.hash && state.detailNavigationPending) {
      state.pendingListRestore = source;
      state.detailNavigationPending = false;
      history.back();
      return;
    }
    state.detailReturn = null;
    state.pendingListRestore = null;
    state.detailNavigationPending = false;
    location.hash = linkTo({ name: 'home', siteId: state.route?.siteId || 'ja', page: 1 });
  }

  function reconcileDetailNavigation(next) {
    const currentHash = location.hash;
    const source = state.detailReturn;
    if (next.name === 'detail') {
      if (source?.detailHash === currentHash) return;
      state.detailReturn = null;
      state.pendingListRestore = null;
      state.detailNavigationPending = false;
      return;
    }
    if (state.pendingListRestore?.hash === currentHash) return;
    if (state.route?.name === 'detail' && source?.hash === currentHash) {
      state.pendingListRestore = source;
      state.detailNavigationPending = false;
      return;
    }
    state.detailReturn = null;
    state.pendingListRestore = null;
    state.detailNavigationPending = false;
  }

  function currentSite() {
    return state.navData.sites.find((s) => s.id === state.route?.siteId) || state.navData.sites[0] || { id: 'ja', name: '看聚合', feeds: [] };
  }

  function quickNavHTML(activeSiteId) {
    const sites = state.navData.sites;
    if (!sites.length) return '';
    return sites.map((site) => `
      <a class="nav-item${site.id === activeSiteId ? ' active' : ''}" href="#/${encodeURIComponent(site.id)}/" data-link${site.id === activeSiteId ? ' aria-current="page"' : ''}>${esc(site.name)}</a>`).join('');
  }

  function feedNavHTML(site, activeFeedId) {
    const feeds = site?.feeds || [];
    if (!feeds.length) return '';
    return `<nav class="quick-categories" aria-label="频道分类">${feeds.map((feed) => `
      <a class="nav-item${feed.id === activeFeedId ? ' active' : ''}" href="#/${encodeURIComponent(site.id)}/category/${encodeURIComponent(feed.id)}" data-link${feed.id === activeFeedId ? ' aria-current="page"' : ''}>${esc(feed.name)}</a>`).join('')}</nav>`;
  }

  function renderNav() {
    const route = state.route || parseHash();
    rankNav.innerHTML = `<a class="chip" href="#/${encodeURIComponent(route.siteId || 'ja')}/" data-link${route.name === 'home' ? ' aria-current="page"' : ''}>首页</a>`;
    quickNav.innerHTML = quickNavHTML(route.siteId);
    const site = state.navData.sites.find((s) => s.id === route.siteId);
    catNav.innerHTML = (site?.feeds || []).map((feed) => `<a href="#/${encodeURIComponent(site.id)}/category/${encodeURIComponent(feed.id)}" data-link${route.name === 'category' && route.feedId === feed.id ? ' aria-current="page"' : ''}>${esc(feed.name)}</a>`).join('');
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
      state.navReady = true;
      renderNav();
    }
  }

  function pagerHTML(route, page, totalPages, hasNext) {
    const previous = page > 1 ? page - 1 : 0;
    const next = (totalPages ? totalPages > page : hasNext) ? page + 1 : 0;
    const control = (label, targetPage) => targetPage
      ? `<a class="button" href="${esc(linkTo({ ...route, page: targetPage }))}" data-link>${label}</a>`
      : `<button type="button" class="button" disabled>${label}</button>`;
    return `<nav class="pager" aria-label="分页">${control('上一页', previous)}<span>${page} 页${totalPages ? ` / ${totalPages} 页` : ''}</span>${control('下一页', next)}</nav>`;
  }

  async function renderList(route, signal, version) {
    state.currentDetail = null;
    const site = state.navData.sites.find((s) => s.id === route.siteId);
    const feed = route.name === 'category' ? site?.feeds?.find((f) => f.id === route.feedId) : null;
    const title = route.name === 'category' ? (feed?.name || route.feedId) : (site?.name || route.siteId);
    document.title = `${title} · 看聚合`;
    app.setAttribute('aria-busy', 'true');
    announce(`正在加载${title}`);
    app.innerHTML = `<header class="page-head"><div><h1 tabindex="-1" data-page-focus>${esc(title)}</h1><span class="page-meta">浏览目录</span></div></header>${feedNavHTML(site, feed?.id)}${skeletonGrid()}${loadingState()}`;
    const params = new URLSearchParams({ page: String(route.page || 1) });
    if (feed) params.set('feed', feed.id);
    try {
      const data = await request(`/api/${encodeURIComponent(route.siteId)}/posts?${params}`, { signal });
      if (version !== state.version || signal.aborted) return;
      const items = Array.isArray(data.posts) ? data.posts : [];
      const page = Number(data.page || route.page || 1);
      const totalPages = Number(data.totalPages) || 0;
      const hasNext = !!data.hasNext;
      const heading = `<header class="page-head"><div><h1 tabindex="-1" data-page-focus>${esc(title)}</h1><span class="page-meta">第 ${page} 页 · ${items.length} 条</span></div></header>`;
      app.innerHTML = `${heading}${feedNavHTML(site, feed?.id)}${items.length ? `<section class="content-grid">${items.map((item) => cardHTML(item, route.siteId)).join('')}</section>${pagerHTML(route, page, totalPages, hasNext)}` : emptyState('没有找到相关内容')}`;
      wireImages();
      const restore = state.pendingListRestore?.hash === location.hash ? state.pendingListRestore : null;
      state.pendingListRestore = null;
      const focusCard = restore?.itemId
        ? Array.from(app.querySelectorAll('.content-card[data-item-id]')).find((card) => card.dataset.itemId === restore.itemId)
        : null;
      const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      const restoreY = Number.isFinite(restore?.scrollY) ? Math.min(restore.scrollY, maxScroll) : 0;
      window.scrollTo({ top: restore ? restoreY : 0, behavior: 'auto' });
      state.detailReturn = null;
      state.detailNavigationPending = false;
      finishRoute({ message: `${title}，第 ${page} 页，共 ${items.length} 条内容`, focus: focusCard });
    } catch (error) {
      if (error?.name === 'AbortError' || version !== state.version || state.canceledVersion === version) return;
      app.innerHTML = errorState(error.message || '列表暂时不可用');
      finishRoute({ message: error.message || '列表暂时不可用', error: true });
    }
  }

  function detailSkeleton() {
    return `<button type="button" class="button back-button" data-detail-back>← 返回</button><div class="detail-layout"><section class="detail-main"><div class="player-shell player-skeleton"><div class="skeleton-media"></div></div><div class="detail-copy"><div class="skeleton-line"></div><div class="skeleton-line short"></div></div></section></div>`;
  }

  function playerHTML() {
    return `<div class="player-shell"><div class="art-player" id="art-player"></div><div class="player-feedback" id="playerFeedback" role="status" aria-live="polite" aria-atomic="true"><div class="feedback-label"><span class="loader" aria-hidden="true"></span><span>正在加载</span><button type="button" class="button" data-player-cancel>取消</button></div></div></div>`;
  }

  function playerFeedback(message, mode = 'loading', session = null) {
    if (session != null && state.playerSession !== session) return;
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

  function attachHls(video, url, art, session) {
    let recoveryUsed = false;
    const isCurrent = () => state.playerSession === session;
    if (!isCurrent()) return;
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
      if (isCurrent() && state.hls === hls) hls.loadSource(url);
    });
    hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
      if (isCurrent() && state.hls === hls) playerFeedback('', 'loading', session);
    });
    hls.on(window.Hls.Events.ERROR, (_event, data) => {
      if (!isCurrent() || state.hls !== hls) return;
      if (!data?.fatal) return;
      if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR && !recoveryUsed) {
        recoveryUsed = true;
        playerFeedback('网络波动，正在重连', 'loading', session);
        hls.startLoad();
        return;
      }
      playerFeedback('播放失败，请重试', 'error', session);
    });
    art.on('destroy', () => {
      if (state.hls === hls) state.hls = null;
      if (state.playerSession === session) try { hls.destroy(); } catch {}
    });
    hls.attachMedia(video);
  }

  async function attachPlayer(playUrl, poster) {
    destroyPlayer();
    if (!playUrl) {
      playerFeedback('播放地址暂时不可用', 'error');
      return;
    }
    const session = state.playerSession;
    const controller = new AbortController();
    state.playerController = controller;
    playerFeedback('正在准备播放', 'loading', session);
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
        customType: { m3u8: (video, url, art) => attachHls(video, url, art, session) },
      });
      if (state.playerSession !== session) {
        try { art.destroy(true); } catch {}
        return;
      }
      state.art = art;
      const video = art.video;
      const mediaEvents = new AbortController();
      state.mediaEvents = mediaEvents;
      const isCurrent = () => state.playerSession === session && state.art === art;
      const artContainer = document.querySelector('#art-player');
      if (artContainer) {
        const isControl = (e) => !!(e.target && e.target.closest && e.target.closest('.art-control, .art-contextmenu, .art-settings, .art-selector, .art-progress, .art-bottom .art-controls'));
        const fmtTime = (sec) => {
          if (!Number.isFinite(sec) || sec < 0) return '00:00';
          const h = Math.floor(sec / 3600);
          const m = Math.floor((sec % 3600) / 60);
          const s = Math.floor(sec % 60);
          const mm = String(m).padStart(2, '0');
          const ss = String(s).padStart(2, '0');
          return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
        };
        const showSeekTime = (target) => {
          try { art.notice.show = `${fmtTime(target)} / ${fmtTime(video.duration)}`; } catch {}
        };
        const clearSeekTime = () => {
          try { art.notice.show = ''; } catch {}
        };
        let drag = null;
        let suppressClick = false;
        const onMouseDown = (e) => {
          if (isControl(e)) return;
          if (e.button !== 0) return;
          drag = { x: e.clientX, y: e.clientY, t: video.currentTime || 0, moved: false };
        };
        const onMouseMove = (e) => {
          if (!drag) return;
          const dx = e.clientX - drag.x;
          const dy = e.clientY - drag.y;
          if (!drag.moved) {
            if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
            if (Math.abs(dx) < Math.abs(dy)) { drag = null; return; }
            drag.moved = true;
          }
          e.preventDefault();
          const width = artContainer.clientWidth || 1;
          const delta = (dx / width) * (video.duration || 0);
          const target = Math.max(0, Math.min(video.duration || 0, drag.t + delta));
          video.currentTime = target;
          showSeekTime(target);
        };
        const onMouseUp = (e) => {
          if (drag && drag.moved) {
            suppressClick = true;
            window.clearTimeout(state.playerClickTimer);
            state.playerClickTimer = window.setTimeout(() => {
              if (isCurrent()) {
                state.playerClickTimer = null;
                suppressClick = false;
              }
            }, 400);
            clearSeekTime();
          }
          drag = null;
        };
        const suppressClickHandler = (e) => {
          if (isCurrent() && suppressClick) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
          }
        };
        artContainer.addEventListener('click', suppressClickHandler, { capture: true, signal: mediaEvents.signal });
        artContainer.addEventListener('mousedown', onMouseDown, { capture: true, signal: mediaEvents.signal });
        window.addEventListener('mousemove', onMouseMove, { capture: true, signal: mediaEvents.signal });
        window.addEventListener('mouseup', onMouseUp, { capture: true, signal: mediaEvents.signal });
      }
      const ready = () => {
        if (!isCurrent()) return;
        window.clearTimeout(state.playerTimer);
        state.playerTimer = null;
        playerFeedback('', 'loading', session);
      };
      const options = { signal: mediaEvents.signal };
      video.addEventListener('loadstart', () => {
        if (isCurrent()) playerFeedback('正在加载', 'loading', session);
      }, options);
      video.addEventListener('loadedmetadata', ready, options);
      video.addEventListener('canplay', ready, options);
      video.addEventListener('playing', ready, options);
      video.addEventListener('waiting', () => {
        if (!isCurrent()) return;
        playerFeedback('正在缓冲', 'loading', session);
        window.clearTimeout(state.playerTimer);
        state.playerTimer = window.setTimeout(() => {
          if (isCurrent() && video.readyState < 3) playerFeedback('等待时间较长，请重试', 'error', session);
        }, 18_000);
      }, options);
      video.addEventListener('seeking', () => {
        if (isCurrent()) playerFeedback('正在定位', 'loading', session);
      }, options);
      video.addEventListener('seeked', ready, options);
      video.addEventListener('error', () => {
        if (isCurrent() && !state.hls) playerFeedback('播放失败，请重试', 'error', session);
      }, options);
      art.on('ready', () => {
        if (isCurrent()) ready();
      });
      if (video.readyState >= 3) ready();
    } catch (error) {
      if (error?.name === 'AbortError' || state.playerSession !== session) return;
      destroyPlayer({ abortRequest: false });
      playerFeedback(error.message || '播放地址暂时不可用', 'error');
    }
  }

  async function renderDetail(route, signal, version) {
    destroyPlayer();
    document.title = '加载中 · 看聚合';
    app.setAttribute('aria-busy', 'true');
    announce('正在加载详情');
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
          <h1 tabindex="-1" data-page-focus>${esc(post.title || '未命名内容')}</h1>
          <div class="detail-meta">${meta ? `<span>${esc(meta)}</span>` : ''}</div>
          ${tags ? `<div class="tag-list">${tags}</div>` : ''}
          <div class="detail-actions">${post.playUrl ? '<button type="button" class="button primary" data-player-retry>重新加载播放</button>' : ''}</div>
        </div>
        ${post.description ? `<section class="detail-body"><p>${esc(post.description)}</p></section>` : ''}
      </section></div>`;
      wireImages();
      window.scrollTo({ top: 0, behavior: 'auto' });
      finishRoute({ message: `已打开${post.title || '详情'}` });
      if (post.playUrl) await attachPlayer(post.playUrl, post.coverUrl);
    } catch (error) {
      if (error?.name === 'AbortError' || version !== state.version || state.canceledVersion === version) return;
      app.innerHTML = `<button type="button" class="button back-button" data-detail-back>← 返回</button>${errorState(error.message || '详情暂时不可用')}`;
      finishRoute({ message: error.message || '详情暂时不可用', error: true });
    }
  }

  function cancelCurrentRequest() {
    if (!state.controller) return;
    state.canceledVersion = state.version;
    state.controller.abort();
    destroyPlayer();
    app.innerHTML = errorState('已取消当前请求', {
      title: '加载已取消',
      back: state.route?.name === 'detail',
    });
    finishRoute({ message: '已取消当前请求' });
  }

  async function route() {
    state.controller?.abort();
    destroyPlayer();
    state.controller = new AbortController();
    state.version += 1;
    state.canceledVersion = 0;
    app.setAttribute('aria-busy', 'true');
    const version = state.version;
    const next = parseHash();
    reconcileDetailNavigation(next);
    state.route = next;
    renderNav();
    if (!state.navReady) {
      await state.navPromise;
      if (version !== state.version || state.controller.signal.aborted) return;
    }
    if (next.name === 'home') return renderList(next, state.controller.signal, version);
    if (next.name === 'category') return renderList(next, state.controller.signal, version);
    if (next.name === 'detail') return renderDetail(next, state.controller.signal, version);
    return renderList({ name: 'home', siteId: next.siteId, page: 1 }, state.controller.signal, version);
  }

  menuBtn.addEventListener('click', () => setDrawer(true));
  drawerClose.addEventListener('click', () => setDrawer(false));
  drawerMask.addEventListener('click', () => setDrawer(false));

  document.addEventListener('keydown', (event) => {
    if (!drawer.classList.contains('open')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      setDrawer(false);
      return;
    }
    if (event.key !== 'Tab') return;
    const elements = drawerFocusable();
    if (!elements.length) {
      event.preventDefault();
      drawerClose.focus({ preventScroll: true });
      return;
    }
    const first = elements[0];
    const last = elements[elements.length - 1];
    if (event.shiftKey ? document.activeElement === first : document.activeElement === last) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus({ preventScroll: true });
    }
  });

  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const cancel = target?.closest('[data-cancel-route]');
    if (cancel) {
      event.preventDefault();
      cancelCurrentRequest();
      return;
    }
    if (target?.closest('[data-retry-route]')) {
      event.preventDefault();
      route();
      return;
    }
    if (target?.closest('[data-detail-back]')) {
      event.preventDefault();
      returnFromDetail();
      return;
    }
    if (target?.closest('[data-player-cancel]')) {
      event.preventDefault();
      destroyPlayer();
      playerFeedback('已取消播放解析', 'error');
      return;
    }
    if (target?.closest('[data-player-retry]') && state.currentDetail?.post?.playUrl) {
      event.preventDefault();
      attachPlayer(state.currentDetail.post.playUrl, state.currentDetail.post.coverUrl);
    }
    const link = target?.closest('a[data-link]');
    if (link) {
      if (link.matches('.content-card')) rememberListView(link);
      setDrawer(false, { restoreFocus: false });
    }
  });

  window.addEventListener('hashchange', route);
  renderNav();
  state.navPromise = loadNav();
  route();
})();
