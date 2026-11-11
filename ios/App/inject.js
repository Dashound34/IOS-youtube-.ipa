// Runs at document start inside m.youtube.com (page world).
// Ad removal, SponsorBlock, dislike counts, speed memory, background playback, clean share links.
(() => {
  'use strict';
  if (window.__ranchLoaded) return;
  window.__ranchLoaded = true;

  const DEFAULTS = {
    sponsorBlock: true,
    skipCategories: ['sponsor', 'selfpromo', 'interaction'],
    dislikes: true,
    hideShorts: false,
    cleanShareLinks: true,
  };
  let S = Object.assign({}, DEFAULTS, window.__RANCH_SETTINGS__ || {});

  const origParse = JSON.parse;

  // ---------- native bridge (fetches go through Swift, limited to SponsorBlock + RYD) ----------
  async function nativeGet(url) {
    const h = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.ranchFetch;
    if (!h) throw new Error('no bridge');
    const r = await h.postMessage(url);
    if (!r || r.status < 200 || r.status >= 300) throw new Error('HTTP ' + (r && r.status));
    return origParse(r.body);
  }

  // ---------- 1. strip ads from player data ----------
  const AD_KEYS = ['adPlacements', 'adSlots', 'playerAds', 'adBreakHeartbeatParams'];
  function strip(o) {
    if (!o || typeof o !== 'object') return o;
    if (Array.isArray(o)) {
      for (const item of o) if (item && typeof item === 'object' && !Array.isArray(item)) strip(item);
      return o;
    }
    for (const k of AD_KEYS) if (k in o) delete o[k];
    if (o.playerResponse && typeof o.playerResponse === 'object') strip(o.playerResponse);
    return o;
  }

  JSON.parse = function (text, reviver) {
    const r = origParse.call(this, text, reviver);
    try { if (r && typeof r === 'object') strip(r); } catch (_) {}
    return r;
  };

  const origJson = Response.prototype.json;
  Response.prototype.json = function () {
    return origJson.call(this).then((r) => {
      try { strip(r); } catch (_) {}
      return r;
    });
  };

  let initialPlayerResponse;
  try {
    Object.defineProperty(window, 'ytInitialPlayerResponse', {
      configurable: true,
      get: () => initialPlayerResponse,
      set: (v) => { initialPlayerResponse = strip(v); },
    });
  } catch (_) {}

  // ---------- 2. keep playing in the background / no "Continue watching?" ----------
  try {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    Object.defineProperty(document, 'webkitVisibilityState', { configurable: true, get: () => 'visible' });
  } catch (_) {}
  const swallow = (e) => e.stopImmediatePropagation();
  window.addEventListener('visibilitychange', swallow, true);
  window.addEventListener('webkitvisibilitychange', swallow, true);

  // ---------- 3. CSS: sponsored cards, Shorts, toast ----------
  const BASE_CSS = `
    ad-slot-renderer, ytm-promoted-sparkles-web-renderer, ytm-promoted-video-renderer,
    ytm-companion-ad-renderer, ytm-companion-slot, ytm-display-ad-renderer,
    ytm-rich-item-renderer:has(ad-slot-renderer), ytm-item-section-renderer:has(> ad-slot-renderer),
    ytm-paid-content-overlay-renderer, .ytp-ad-overlay-container { display: none !important; }
    #ranch-toast { position: fixed; left: 50%; bottom: 72px; transform: translate(-50%, 20px);
      z-index: 99999; display: flex; gap: 14px; align-items: center; padding: 10px 16px;
      border-radius: 10px; background: rgba(30,30,30,.95); color: #fff; font: 500 14px -apple-system, sans-serif;
      opacity: 0; pointer-events: none; transition: opacity .2s, transform .2s; }
    #ranch-toast.show { opacity: 1; transform: translate(-50%, 0); pointer-events: auto; }
    #ranch-toast button { background: none; border: 0; color: #3ea6ff; font: inherit; font-weight: 600; padding: 0; }
    #ranch-gear { background: none; border: 0; color: inherit; font-size: 20px; width: 40px; height: 40px;
      display: inline-flex; align-items: center; justify-content: center; padding: 0; }
  `;
  const SHORTS_CSS = `
    ytm-reel-shelf-renderer, ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2,
    ytm-rich-section-renderer:has(ytm-shorts-lockup-view-model),
    ytm-rich-section-renderer:has(ytm-reel-shelf-renderer),
    ytm-pivot-bar-item-renderer:has(.pivot-shorts) { display: none !important; }
  `;
  function applyCss() {
    let style = document.getElementById('ranch-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'ranch-style';
      (document.head || document.documentElement).appendChild(style);
    }
    style.textContent = BASE_CSS + (S.hideShorts ? SHORTS_CSS : '');
  }
  applyCss();

  // ---------- helpers ----------
  function currentVideoId() {
    const u = new URL(location.href);
    if (u.pathname === '/watch') return u.searchParams.get('v');
    const m = u.pathname.match(/^\/(?:shorts|live)\/([\w-]{11})/);
    return m ? m[1] : null;
  }
  const isAd = () => !!document.querySelector('.ad-showing, .ad-interrupting');
  const mainVideo = () => document.querySelector('video');

  let toastTimer;
  function toast(message, actionLabel, action) {
    let t = document.getElementById('ranch-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'ranch-toast';
      (document.body || document.documentElement).appendChild(t);
    }
    const text = document.createElement('span');
    text.textContent = message;
    t.replaceChildren(text);
    if (actionLabel) {
      const b = document.createElement('button');
      b.textContent = actionLabel;
      b.addEventListener('click', () => { action(); t.classList.remove('show'); });
      t.appendChild(b);
    }
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 5000);
  }

  // ---------- 4. skip any ad that slips through ----------
  let mutedForAd = false;
  function handleAd() {
    const v = mainVideo();
    if (isAd()) {
      document.querySelectorAll('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button')
        .forEach((b) => b.click());
      if (v) {
        if (!v.muted) { v.muted = true; mutedForAd = true; }
        if (isFinite(v.duration) && v.duration > 0 && v.currentTime < v.duration - 0.1) v.currentTime = v.duration;
      }
    } else if (mutedForAd && v) {
      v.muted = false;
      mutedForAd = false;
    }
  }

  // ---------- 5. remember playback speed ----------
  let lastLoad = 0;
  let speedAppliedFor = null;
  document.addEventListener('loadstart', () => { lastLoad = Date.now(); }, true);
  document.addEventListener('ratechange', (e) => {
    const v = e.target;
    if (!(v instanceof HTMLVideoElement) || isAd() || Date.now() - lastLoad < 2000) return;
    try { localStorage.setItem('ranch.speed', String(v.playbackRate)); } catch (_) {}
  }, true);
  document.addEventListener('playing', (e) => {
    const v = e.target;
    if (!(v instanceof HTMLVideoElement) || isAd()) return;
    const vid = currentVideoId();
    if (!vid || speedAppliedFor === vid) return;
    speedAppliedFor = vid;
    let speed = NaN;
    try { speed = parseFloat(localStorage.getItem('ranch.speed')); } catch (_) {}
    if (speed > 0 && v.playbackRate !== speed) v.playbackRate = speed;
  }, true);

  // ---------- 6. SponsorBlock ----------
  const SB_LABELS = {
    sponsor: 'sponsor', selfpromo: 'self-promotion', interaction: 'subscribe reminder', intro: 'intro',
    outro: 'endcard', preview: 'preview', filler: 'filler', music_offtopic: 'non-music section',
  };
  const SB_COLORS = {
    sponsor: '#00d400', selfpromo: '#ffff00', interaction: '#cc00ff', intro: '#00ffff',
    outro: '#0202ed', preview: '#008fd6', filler: '#7300ff', music_offtopic: '#ff9900',
  };
  let segments = [];
  let segVid = null;
  let skipped = new Set();

  async function sha256Hex(s) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function loadSegments(vid) {
    segments = [];
    skipped = new Set();
    segVid = vid;
    if (!S.sponsorBlock || !S.skipCategories.length) return;
    let data;
    try {
      const prefix = (await sha256Hex(vid)).slice(0, 4);
      const cats = encodeURIComponent(JSON.stringify(S.skipCategories));
      data = await nativeGet(`https://sponsor.ajay.app/api/skipSegments/${prefix}?categories=${cats}`);
    } catch (_) { return; } // 404 just means no segments
    if (segVid !== vid || !Array.isArray(data)) return;
    const entry = data.find((d) => d.videoID === vid);
    if (!entry) return;
    segments = entry.segments
      .filter((s) => (s.actionType || 'skip') === 'skip')
      .map((s) => ({ start: s.segment[0], end: s.segment[1], category: s.category, uuid: s.UUID }));
  }

  document.addEventListener('timeupdate', (e) => {
    const v = e.target;
    if (!(v instanceof HTMLVideoElement)) return;
    if (isAd()) { handleAd(); return; }
    if (!segments.length || currentVideoId() !== segVid) return;
    const t = v.currentTime;
    for (const s of segments) {
      if (t >= s.start && t < s.end - 0.3 && !skipped.has(s.uuid)) {
        skipped.add(s.uuid);
        v.currentTime = s.end;
        toast(`Skipped ${SB_LABELS[s.category] || s.category}`, 'Undo', () => { v.currentTime = s.start; });
        break;
      }
    }
  }, true);

  function drawMarks() {
    const bar = document.querySelector('.ytp-progress-bar, .ytm-progress-bar');
    const v = mainVideo();
    let layer = document.getElementById('ranch-marks');
    const ok = bar && v && segments.length && segVid === currentVideoId() && isFinite(v.duration) && v.duration > 0 && !isAd();
    if (!ok) { if (layer) layer.remove(); return; }
    const key = `${segVid}:${segments.length}:${Math.round(v.duration)}`;
    if (layer && layer.parentElement === bar && layer.dataset.key === key) return;
    if (layer) layer.remove();
    layer = document.createElement('div');
    layer.id = 'ranch-marks';
    layer.dataset.key = key;
    layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:40';
    for (const s of segments) {
      const m = document.createElement('div');
      const left = (s.start / v.duration) * 100;
      const width = Math.max(0.4, ((s.end - s.start) / v.duration) * 100);
      m.style.cssText = `position:absolute;top:0;bottom:0;left:${left}%;width:${width}%;` +
        `background:${SB_COLORS[s.category] || '#00d400'};opacity:.85`;
      layer.appendChild(m);
    }
    if (getComputedStyle(bar).position === 'static') bar.style.position = 'relative';
    bar.appendChild(layer);
  }

  // ---------- 7. dislike counts (Return YouTube Dislike) ----------
  let dislikeData = null;
  const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });

  async function loadDislikes(vid) {
    dislikeData = null;
    if (!S.dislikes) return;
    try {
      const d = await nativeGet(`https://returnyoutubedislikeapi.com/votes?videoId=${encodeURIComponent(vid)}`);
      if (currentVideoId() === vid && typeof d.dislikes === 'number') dislikeData = { vid, dislikes: d.dislikes };
    } catch (_) {}
  }

  function renderDislikes() {
    const existing = document.querySelectorAll('.ranch-dislikes');
    if (!S.dislikes || !dislikeData || dislikeData.vid !== currentVideoId()) {
      existing.forEach((e) => e.remove());
      return;
    }
    const btn = Array.from(document.querySelectorAll('button[aria-label]'))
      .find((b) => /dislike/i.test(b.getAttribute('aria-label')) && b.offsetParent);
    if (!btn) return;
    let span = btn.querySelector('.ranch-dislikes');
    if (!span) {
      existing.forEach((e) => e.remove());
      span = document.createElement('span');
      span.className = 'ranch-dislikes';
      span.style.cssText = 'margin-left:6px;font-size:14px;font-weight:500';
      btn.appendChild(span);
    }
    const text = compact.format(dislikeData.dislikes);
    if (span.textContent !== text) span.textContent = text;
  }

  // ---------- 8. clean shared links ----------
  function cleanUrl(u) {
    try {
      const x = new URL(u);
      if (!/(^|\.)(youtube\.com|youtu\.be)$/.test(x.hostname)) return u;
      ['si', 'pp', 'feature'].forEach((p) => x.searchParams.delete(p));
      return x.toString();
    } catch (_) { return u; }
  }
  const cleanText = (t) => (S.cleanShareLinks ? String(t).replace(/https?:\/\/[^\s]+/g, cleanUrl) : t);

  if (navigator.share) {
    const origShare = navigator.share.bind(navigator);
    navigator.share = (data) => {
      if (S.cleanShareLinks && data) {
        data = Object.assign({}, data);
        if (data.url) data.url = cleanUrl(data.url);
        if (data.text) data.text = cleanText(data.text);
      }
      return origShare(data);
    };
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    const origWrite = navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText = (t) => origWrite(cleanText(t));
  }
  document.addEventListener('copy', (e) => {
    if (!S.cleanShareLinks) return;
    const sel = String(window.getSelection() || '');
    if (!/youtu/.test(sel)) return;
    e.clipboardData.setData('text/plain', cleanText(sel));
    e.preventDefault();
  }, true);

  // ---------- 9. settings gear in the top bar ----------
  function addGear() {
    if (document.getElementById('ranch-gear')) return;
    const header = document.querySelector('.mobile-topbar-header-content');
    if (!header) return;
    const b = document.createElement('button');
    b.id = 'ranch-gear';
    b.setAttribute('aria-label', 'App settings');
    b.textContent = '⚙︎';
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      try { window.webkit.messageHandlers.ranch.postMessage('openSettings'); } catch (_) {}
    });
    header.appendChild(b);
  }

  // ---------- settings from the native side ----------
  let lastVid;
  window.__ranchApplySettings = (next) => {
    S = Object.assign({}, DEFAULTS, next || {});
    applyCss();
    lastVid = undefined; // reload segments + dislikes for the current video
  };

  // ---------- main loop ----------
  setInterval(() => {
    const vid = currentVideoId();
    if (vid && S.hideShorts && location.pathname.startsWith('/shorts/')) {
      location.replace('/watch?v=' + vid);
      return;
    }
    if (vid !== lastVid) {
      lastVid = vid;
      speedAppliedFor = null;
      lastLoad = Date.now();
      if (vid) { loadSegments(vid); loadDislikes(vid); } else { segments = []; dislikeData = null; }
    }
    handleAd();
    drawMarks();
    renderDislikes();
    addGear();
    window._lact = Date.now(); // stops the "Video paused. Continue watching?" prompt
  }, 500);
})();
