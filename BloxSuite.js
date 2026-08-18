// ==UserScript==
// @name         Blox Suite
// @namespace    http://tampermonkey.net/
// @version      4.3.2
// @description  Roblox extension with many useful features.
// @author       ythundered
// @match        https://www.roblox.com/*
// @icon         https://www.roblox.com/favicon.ico
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @connect      users.roblox.com
// @connect      thumbnails.roblox.com
// @connect      presence.roblox.com
// @connect      inventory.roblox.com
// @connect      api.rolimons.com
// @connect      www.rolimons.com
// @connect      rolimons.com
// @connect      bloxsuiteusers.cobfuscated.workers.dev
// @connect      cobfuscated.workers.dev
// @connect      workers.dev
// @connect      *
// @run-at       document-start
// ==/UserScript==
(function () {
  'use strict';

  const BLOX_SUITE_VERSION = '4.3.2';

  const STATS_URL = 'https://bloxsuiteusers.cobfuscated.workers.dev';
  console.log('[Blox Suite] v' + BLOX_SUITE_VERSION + ' loaded');

  const DEFAULTS = {
    enabled: true,
    robuxEnabled: false,
    robuxValue: null,
    verifiedEnabled: false,
    fakeFriends: [],
    greetingEnabled: true,
    valuesEnabled: true,
    hideSerials: false,
    debugValues: false,
    shareUsage: true,
  };
  const STORE_KEY = 'bloxSuiteSettings';

  let settings = null;

  function loadSettings() {
    let raw = null;
    try {
      raw = GM_getValue(STORE_KEY, null);
    } catch (e) {}
    if (!raw) {
      try {
        raw = localStorage.getItem(STORE_KEY);
      } catch (e) {}
    }
    let parsed = {};
    if (raw) {
      try {
        parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      } catch (e) {
        parsed = {};
      }
    }
    settings = Object.assign({}, DEFAULTS, parsed);
    return settings;
  }

  function saveSettings() {
    const payload = JSON.stringify(settings);
    try {
      GM_setValue(STORE_KEY, payload);
    } catch (e) {}
    try {
      localStorage.setItem(STORE_KEY, payload);
    } catch (e) {}
  }
  const store = {
    get(key) {
      if (!settings) loadSettings();
      return settings[key];
    },
    set(key, value) {
      if (!settings) loadSettings();
      settings[key] = value;
      saveSettings();
    },
  };

  let ownUserId = null;

  let liveRobux = null;
  const friendCache = {};
  const friendPending = {};

  let themeTokens = null;

  function formatRobux(n) {
    const num = Math.max(0, Math.floor(Number(n) || 0));
    return num.toLocaleString('en-US');
  }

  function abbreviateRobux(n) {
    const num = Math.max(0, Math.floor(Number(n) || 0));
    if (num < 10000) return num.toLocaleString('en-US');
    const units = [
      { v: 1e12, s: 'T' },
      { v: 1e9, s: 'B' },
      { v: 1e6, s: 'M' },
      { v: 1e3, s: 'K' },
    ];
    for (const u of units) {
      if (num >= u.v) return Math.floor(num / u.v) + u.s + '+';
    }
    return num.toLocaleString('en-US');
  }

  const PLUS_ICON_SELECTOR = 'span[data-testid="foundation-web-icon"].icon-regular-roblox-plus';

  function detectOwnUserId() {
    const selectors = [
      '#nav-profile[href*="/users/"]',
      '#navigation a[href*="/users/"][href*="/profile"]',
      '#left-navigation-container a[href*="/users/"][href*="/profile"]',
    ];
    for (const sel of selectors) {
      const link = document.querySelector(sel);
      if (!link) continue;
      const m = (link.getAttribute('href') || '').match(/\/users\/(\d+)/);
      if (m) {
        if (ownUserId && m[1] !== ownUserId) revertVerifiedBadge();
        ownUserId = m[1];
        return ownUserId;
      }
    }
    const meta = document.querySelector('meta[name="user-data"]');
    if (meta) {
      const id = meta.getAttribute('data-userid');
      if (id && /^\d+$/.test(id)) {
        if (ownUserId && id !== ownUserId) revertVerifiedBadge();
        ownUserId = id;
        return ownUserId;
      }
    }
    return ownUserId;
  }

  function parseColor(str) {
    const m = (str || '').match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/i);
    if (!m) return null;
    return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  }

  function toRgb(c) {
    return 'rgb(' + Math.round(c.r) + ', ' + Math.round(c.g) + ', ' + Math.round(c.b) + ')';
  }

  function blend(fg, bg) {
    if (!fg) return bg;
    if (!bg) return fg;
    const a = fg.a;
    return {
      r: fg.r * a + bg.r * (1 - a),
      g: fg.g * a + bg.g * (1 - a),
      b: fg.b * a + bg.b * (1 - a),
      a: 1,
    };
  }

  function resolveOpaqueBackground() {
    let node = document.body;
    while (node) {
      const c = parseColor(getComputedStyle(node).backgroundColor);
      if (c && c.a === 1) return c;
      node = node.parentElement;
    }
    const htmlColor = parseColor(getComputedStyle(document.documentElement).color);
    const darkText = htmlColor ? (0.299 * htmlColor.r + 0.587 * htmlColor.g + 0.114 * htmlColor.b) / 255 < 0.5 : true;
    return darkText ? { r: 255, g: 255, b: 255, a: 1 } : { r: 25, g: 27, b: 29, a: 1 };
  }

  function probeColor(classes, prop) {
    const el = document.createElement('span');
    el.className = classes;
    el.style.position = 'absolute';
    el.style.opacity = '0';
    el.style.pointerEvents = 'none';
    (document.body || document.documentElement).appendChild(el);
    const val = getComputedStyle(el)[prop];
    el.remove();
    return val && val !== 'rgba(0, 0, 0, 0)' ? val : null;
  }

  function readThemeTokens() {
    const base = resolveOpaqueBackground();
    const baseLum = (0.299 * base.r + 0.587 * base.g + 0.114 * base.b) / 255;
    const dark = baseLum < 0.5;
    const shift = parseColor(probeColor('bg-shift-300', 'backgroundColor'));
    const surfaceC = shift ? blend(shift, base) : base;
    const panelOverlay = dark ? { r: 255, g: 255, b: 255, a: 0.07 } : { r: 0, g: 0, b: 0, a: 0.04 };
    const borderOverlay = dark ? { r: 255, g: 255, b: 255, a: 0.16 } : { r: 0, g: 0, b: 0, a: 0.12 };
    const textC = parseColor(probeColor('content-default', 'color')) ||
           parseColor(getComputedStyle(document.body).color) ||
           (dark ? { r: 255, g: 255, b: 255, a: 1 } : { r: 57, g: 59, b: 61, a: 1 });
    let accentC = parseColor(probeColor('bg-action-standard', 'backgroundColor'));
    if (accentC && accentC.a < 1) accentC = blend(accentC, surfaceC);
    if (!accentC) accentC = { r: 0, g: 162, b: 255, a: 1 };
    let accentTextC = parseColor(probeColor('content-action-standard', 'color'));
    if (!accentTextC || accentTextC.a < 1) {
      const aLum = (0.299 * accentC.r + 0.587 * accentC.g + 0.114 * accentC.b) / 255;
      accentTextC = aLum < 0.6 ? { r: 255, g: 255, b: 255, a: 1 } : { r: 25, g: 27, b: 29, a: 1 };
    }
    return {
      surface: toRgb(surfaceC),
      panel: toRgb(blend(panelOverlay, surfaceC)),
      border: toRgb(blend(borderOverlay, surfaceC)),
      text: toRgb(blend(textC, surfaceC)),
      muted: toRgb(blend({ r: textC.r, g: textC.g, b: textC.b, a: 0.6 }, surfaceC)),
      accent: toRgb(accentC),
      accentText: toRgb(accentTextC),
      dark: dark,
    };
  }

  function applyThemeTokens(force) {
    if (themeTokens && !force) return themeTokens;
    if (!document.body) return null;
    themeTokens = readThemeTokens();
    const root = document.documentElement;
    root.style.setProperty('--bs-surface', themeTokens.surface);
    root.style.setProperty('--bs-panel', themeTokens.panel);
    root.style.setProperty('--bs-border', themeTokens.border);
    root.style.setProperty('--bs-text', themeTokens.text);
    root.style.setProperty('--bs-muted', themeTokens.muted);
    root.style.setProperty('--bs-accent', themeTokens.accent);
    root.style.setProperty('--bs-accent-text', themeTokens.accentText);
    root.style.setProperty('--bs-overlay', themeTokens.dark ? 'rgba(0,0,0,0.65)' : 'rgba(0,0,0,0.5)');
    return themeTokens;
  }

  let csrfToken = null;

  function readCsrfFromPage() {
    const meta = document.querySelector('meta[name="csrf-token"]');
    if (meta && meta.getAttribute('data-token')) return meta.getAttribute('data-token');
    if (meta && meta.content) return meta.content;
    return null;
  }

  function apiGet(url) {
    return fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  }

  function apiPost(url, body, retried) {
    if (!csrfToken) csrfToken = readCsrfFromPage();
    const headers = { 'Content-Type': 'application/json' };
    if (csrfToken) headers['X-CSRF-TOKEN'] = csrfToken;
    return fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: headers,
      body: JSON.stringify(body),
    }).then((r) => {
      if (r.status === 403 && !retried) {
        const fresh = r.headers.get('x-csrf-token');
        if (fresh) {
          csrfToken = fresh;
          return apiPost(url, body, true);
        }
      }
      return r.ok ? r.json() : null;
    }).catch(() => null);
  }

  function fetchThumbnail(id) {
    return apiPost('https://thumbnails.roblox.com/v1/batch', [{
      requestId: id + ':undefined:AvatarHeadShot:150x150:webp:regular',
      type: 'AvatarHeadShot',
      targetId: Number(id),
      format: 'webp',
      size: '150x150',
    }]).then((res) => {
      const d = res && res.data && res.data[0];
      if (d && d.imageUrl) return d.imageUrl;
      return apiGet('https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=' + id + '&size=150x150&format=Webp&isCircular=false')
        .then((r) => {
          const t = r && r.data && r.data[0];
          return t ? t.imageUrl : null;
        });
    }).catch(() => null);
  }

  function fetchFriendData(id) {
    if (friendPending[id]) return friendPending[id];
    const p = Promise.all([
      apiGet('https://users.roblox.com/v1/users/' + id),
      fetchThumbnail(id),
      apiPost('https://presence.roblox.com/v1/presence/users', { userIds: [Number(id)] }),
    ]).then((res) => {
      const user = res[0];
      const avatar = res[1];
      const pres = res[2] && res[2].userPresences && res[2].userPresences[0];
      if (!user || user.errors) return null;
      const data = {
        id: String(id),
        name: user.name,
        displayName: user.displayName || user.name,
        verified: !!user.hasVerifiedBadge,
        avatar: avatar,
        presenceType: pres ? pres.userPresenceType : 0,
        lastLocation: pres ? pres.lastLocation : '',
      };
      friendCache[id] = data;
      return data;
    }).catch(() => null);
    friendPending[id] = p;
    p.then(() => { delete friendPending[id]; });
    return p;
  }

  function presenceClass(type) {
    if (type === 2) return { cls: 'game icon-game', label: 'In experience' };
    if (type === 3) return { cls: 'studio icon-studio', label: 'In Studio' };
    if (type === 1) return { cls: 'online icon-online', label: 'Online' };
    return null;
  }

  function buildBadgeSpan(sizeVar) {
    const outer = document.createElement('span');
    outer.className = 'items-center gap-xxsmall inline-flex shrink-0 [--icon-size-small:1em]';
    outer.appendChild(buildVerifiedBadge(sizeVar));
    return outer;
  }

  function buildFriendTile(data) {
    const href = 'https://www.roblox.com/users/' + data.id + '/profile';
    const outer = document.createElement('div');
    outer.dataset.bloxSuiteFriend = data.id;
    const tile = document.createElement('div');
    tile.className = 'friends-carousel-tile';
    const inner = document.createElement('div');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'options-dropdown';
    btn.id = 'friend-tile-button';
    const content = document.createElement('div');
    content.className = 'friend-tile-content';
    const avatarWrap = document.createElement('div');
    avatarWrap.className = 'avatar avatar-card-fullbody';
    avatarWrap.setAttribute('data-testid', 'avatar-card-container');
    const avatarLink = document.createElement('a');
    avatarLink.className = 'avatar-card-link';
    avatarLink.href = href;
    avatarLink.setAttribute('data-testid', 'avatar-card-link');
    const thumbSpan = document.createElement('span');
    thumbSpan.className = 'thumbnail-2d-container avatar-card-image';
    if (data.avatar) {
      const img = document.createElement('img');
      img.className = '';
      img.src = data.avatar;
      img.alt = '';
      thumbSpan.appendChild(img);
    }
    avatarLink.appendChild(thumbSpan);
    avatarWrap.appendChild(avatarLink);
    const status = document.createElement('div');
    status.className = 'avatar-status';
    const pres = presenceClass(data.presenceType);
    if (pres) {
      const dot = document.createElement('span');
      dot.setAttribute('data-testid', 'presence-icon');
      dot.title = data.lastLocation || pres.label;
      dot.className = pres.cls;
      status.appendChild(dot);
    }
    avatarWrap.appendChild(status);
    const labels = document.createElement('a');
    labels.className = 'friends-carousel-tile-labels';
    labels.href = href;
    labels.setAttribute('data-testid', 'friends-carousel-tile-labels');
    const label = document.createElement('div');
    label.className = 'friends-carousel-tile-label';
    const nameRow = document.createElement('div');
    nameRow.className = 'friends-carousel-tile-name';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'friends-carousel-display-name';
    nameSpan.textContent = data.displayName;
    nameRow.appendChild(nameSpan);
    if (data.verified) nameRow.appendChild(buildBadgeSpan('--icon-size-small'));
    label.appendChild(nameRow);
    const sublabel = document.createElement('div');
    sublabel.className = 'friends-carousel-tile-sublabel';
    if (data.presenceType === 2 && data.lastLocation) {
      const exp = document.createElement('div');
      exp.className = 'friends-carousel-tile-experience';
      exp.textContent = data.lastLocation;
      sublabel.appendChild(exp);
    }
    labels.appendChild(label);
    labels.appendChild(sublabel);
    content.appendChild(avatarWrap);
    content.appendChild(labels);
    btn.appendChild(content);
    inner.appendChild(btn);
    tile.appendChild(inner);
    outer.appendChild(tile);
    return outer;
  }

  function currentProfileUserId() {
    const m = location.pathname.match(/^\/users\/(\d+)/);
    return m ? m[1] : null;
  }

  function buildChatButton() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'user-profile-header-Chat';
    btn.className = 'foundation-web-button relative clip group/interactable focus-visible:outline-focus disabled:outline-none cursor-pointer relative flex items-center justify-center stroke-none padding-y-none select-none radius-medium text-label-medium height-1000 padding-x-medium bg-action-standard content-action-standard';
    btn.style.textDecoration = 'none';
    btn.style.width = '100%';
    btn.dataset.bloxSuiteChat = '1';
    const layer = document.createElement('div');
    layer.setAttribute('aria-hidden', 'true');
    layer.setAttribute('data-testid', 'foundation-web-state-layer');
    layer.className = 'absolute inset-[0] transition-colors group-hover/interactable:bg-[var(--color-state-hover)] group-active/interactable:bg-[var(--color-state-press)] group-disabled/interactable:bg-none';
    const outer = document.createElement('span');
    outer.className = 'flex items-center min-width-0 gap-small';
    const inner = document.createElement('span');
    inner.className = 'padding-y-xsmall text-truncate-end text-no-wrap';
    inner.textContent = 'Chat';
    outer.appendChild(inner);
    btn.appendChild(layer);
    btn.appendChild(outer);
    return btn;
  }

  function applyFriendProfile() {
    if (!store.get('enabled')) return;
    const uid = currentProfileUserId();
    if (!uid) return;
    const ids = store.get('fakeFriends') || [];
    if (ids.indexOf(uid) === -1) return;
    const addBtn = document.querySelector('#user-profile-header-AddFriend');
    if (!addBtn || addBtn.dataset.bloxSuiteHidden === '1') return;
    addBtn.dataset.bloxSuiteHidden = '1';
    addBtn.dataset.bloxSuiteDisplay = addBtn.style.display || '';
    addBtn.style.display = 'none';
    addBtn.insertAdjacentElement('afterend', buildChatButton());
  }

  function revertFriendProfile() {
    document.querySelectorAll('[data-blox-suite-chat="1"]').forEach((el) => el.remove());
    document.querySelectorAll('#user-profile-header-AddFriend[data-blox-suite-hidden="1"]').forEach((el) => {
      el.style.display = el.dataset.bloxSuiteDisplay || '';
      delete el.dataset.bloxSuiteHidden;
      delete el.dataset.bloxSuiteDisplay;
    });
  }

  function parsePriceEl(el) {
    if (!el) return null;
    const digits = (el.textContent || '').replace(/[^\d]/g, '');
    if (!digits) return null;
    const n = parseInt(digits, 10);
    return isNaN(n) || n <= 0 ? null : n;
  }

  function cardPrice(caption) {
    const box = caption.querySelector('.item-card-price');
    if (!box) return null;
    return parsePriceEl(box.querySelector('.text-robux-tile')) || parsePriceEl(box);
  }

  function pageItemName() {
    const el = document.querySelector('.item-details-name-row h1') ||
               document.querySelector('#item-container h1') ||
               document.querySelector('h1');
    return el ? el.textContent.trim() : null;
  }

  function pagePrice() {
    return parsePriceEl(document.querySelector('#item-details .item-price-value .text-robux-lg')) ||
           parsePriceEl(document.querySelector('.item-price-value .text-robux-lg')) ||
           parsePriceEl(document.querySelector('.item-price-value'));
  }

  function resolveValue(entry, fallbackPrice) {
    if (entry && entry.value !== null && entry.value !== undefined) return { amount: entry.value, exact: true };
    if (fallbackPrice !== null && fallbackPrice !== undefined) return { amount: fallbackPrice, exact: false };
    if (entry && entry.rap !== null && entry.rap !== undefined) return { amount: entry.rap, exact: false };
    return { amount: null, exact: false };
  }

  function matchFontFrom(sourceEl, targetEl) {
    if (!sourceEl || !targetEl) return;
    try {
      const cs = getComputedStyle(sourceEl);
      targetEl.style.setProperty('font-family', cs.fontFamily, 'important');
      targetEl.style.setProperty('font-size', cs.fontSize, 'important');
      targetEl.style.setProperty('font-weight', cs.fontWeight, 'important');
      targetEl.style.setProperty('font-style', cs.fontStyle, 'important');
      targetEl.style.setProperty('letter-spacing', cs.letterSpacing, 'important');
    } catch (e) {}
  }

  function valueLine(label, amount, opts) {
    const o = opts || {};
    const wrap = document.createElement('div');
    wrap.className = 'blox-suite-value-line' + (o.compact ? ' compact' : '');
    wrap.dataset.bloxSuiteValue = '1';
    const txt = document.createElement('span');
    txt.className = 'blox-suite-vtext';
    if (label) {
      const lab = document.createElement('span');
      lab.className = 'blox-suite-vlab';
      lab.textContent = label;
      wrap.appendChild(lab);
    }
    if (amount === null || amount === undefined) {
      txt.textContent = '\u2014';
      txt.classList.add('muted');
    } else {
      txt.textContent = (o.signed && amount > 0 ? '+' : '') + formatRobux(Math.abs(amount) === amount ? amount : amount);
      if (o.signed) txt.classList.add(amount > 0 ? 'up' : amount < 0 ? 'down' : 'flat');
    }
    wrap.appendChild(txt);
    return wrap;
  }

  function signedText(n) {
    const sign = n > 0 ? '+' : n < 0 ? '\u2212' : '';
    return sign + formatRobux(Math.abs(n));
  }

  function applyItemValue() {
    if (!store.get('enabled') || !store.get('valuesEnabled')) return;
    const item = currentCatalogItem();
    if (!item) return;
    const host = document.querySelector('#item-details .price-info') ||
                 document.querySelector('.price-info.row-content') ||
                 document.querySelector('#item-details .price-row-container');
    if (!host || host.dataset.bloxSuiteValueHost === '1') return;
    host.dataset.bloxSuiteValueHost = '1';
    getItemValue(item.id, pageItemName()).then((entry) => {
      const price = pagePrice();
      const resolved = resolveValue(entry, price);
      const rap = entry && entry.rap !== null ? entry.rap : null;
      if (resolved.amount === null && rap === null) {
        delete host.dataset.bloxSuiteValueHost;
        return;
      }
      if (host.querySelector('[data-blox-suite-value="1"]')) return;
      if (resolved.amount === null) {
        delete host.dataset.bloxSuiteValueHost;
        return;
      }
      const box = document.createElement('div');
      box.className = 'blox-suite-item-values';
      box.dataset.bloxSuiteValue = '1';
      const vl = valueLine('Value', resolved.amount);
      box.appendChild(vl);
      const anchor = host.querySelector('.item-price-value');
      const priceText = host.querySelector('.item-price-value .text-robux-lg') || anchor;
      matchFontFrom(priceText, vl.querySelector('.blox-suite-vtext'));
      if (anchor) anchor.insertAdjacentElement('afterend', box);
      else host.appendChild(box);
    });
  }

  function itemFromCardLink(href) {
    if (!href) return null;
    const b = href.match(/\/bundles\/(\d+)/);
    if (b) return { type: 'Bundle', id: b[1] };
    const a = href.match(/\/(?:catalog|library)\/(\d+)/);
    if (a) return { type: 'Asset', id: a[1] };
    return null;
  }

  function renderCardValue(caption, priceBox, amount, exact, rap) {
    const line = valueLine('Value', amount, { compact: true });
    matchFontFrom(priceBox.querySelector('.text-robux-tile') || priceBox, line.querySelector('.blox-suite-vtext'));
    priceBox.insertAdjacentElement('afterend', line);
  }

  function dbg() {
    if (!store.get('debugValues')) return;
    console.log.apply(console, ['[Blox Suite]'].concat([].slice.call(arguments)));
  }

  function applyItemCardValues() {
    if (!store.get('enabled') || !store.get('valuesEnabled')) return;
    document.querySelectorAll('.item-card-caption').forEach((caption) => {
      const nameEl = caption.querySelector('.item-card-name');
      const nm = nameEl ? nameEl.textContent.trim() : '(unnamed)';
      const card = caption.closest('.item-card-container') || caption.parentElement;
      if (!card) return dbg(nm, 'skip: no card container');
      if (!card.querySelector('.limited-icon-container')) return dbg(nm, 'skip: not a limited');
      const priceBox = caption.querySelector('.item-card-price');
      if (!priceBox) return dbg(nm, 'skip: no .item-card-price');

      const hasLine = !!caption.querySelector('[data-blox-suite-value="1"]');

      if (caption.dataset.bloxSuiteVal !== undefined) {
        if (hasLine) return;
        dbg(nm, 'rebuilding stripped line from cache');
        renderCardValue(
          caption, priceBox,
          parseInt(caption.dataset.bloxSuiteVal, 10),
          caption.dataset.bloxSuiteExact === '1',
          caption.dataset.bloxSuiteRap !== undefined ? parseInt(caption.dataset.bloxSuiteRap, 10) : null
        );
        applyTradeTotals();
        return;
      }

      if (caption.dataset.bloxSuiteCard === '1') return;
      const link = card.querySelector('a[href]');
      const item = itemFromCardLink(link && link.getAttribute('href'));
      if (!item) return dbg(nm, 'skip: no catalog/bundle link, href =', link && link.getAttribute('href'));
      caption.dataset.bloxSuiteCard = '1';

      getItemValue(item.id, nm).then((entry) => {
        const price = cardPrice(caption);
        const resolved = resolveValue(entry, price);
        const rap = entry && entry.rap !== null ? entry.rap : price;
        dbg(nm, item.type, item.id, '| rolimons =', entry ? ('rap ' + entry.rap + ' value ' + entry.value + (entry.matchedBy ? ' via ' + entry.matchedBy : '')) : 'NOT IN DATASET',
            '| page price =', price, '| using =', resolved.amount, resolved.exact ? '(exact)' : '(est)');
        if (resolved.amount === null && rap === null) {
          dbg(nm, 'FAILED: no value and no price to fall back on');
          delete caption.dataset.bloxSuiteCard;
          return;
        }
        if (rap !== null) caption.dataset.bloxSuiteRap = String(rap);
        if (resolved.amount !== null) {
          caption.dataset.bloxSuiteVal = String(resolved.amount);
          caption.dataset.bloxSuiteExact = resolved.exact ? '1' : '0';
        }
        if (!caption.querySelector('[data-blox-suite-value="1"]')) {
          renderCardValue(caption, priceBox, resolved.amount, resolved.exact, rap);
        }
        applyTradeTotals();
      }).catch((e) => {
        dbg(nm, 'THREW:', e);
        delete caption.dataset.bloxSuiteCard;
      });
    });
  }

  function offerRobux(offer) {
    let extra = 0;
    offer.querySelectorAll('.robux-line').forEach((line) => {
      if (line.dataset.bloxSuiteValue === '1') return;
      const label = line.querySelector('.text-label, .text-lead');
      if (!label || !/robux/i.test(label.textContent)) return;
      const amt = line.querySelector('.robux-line-value');
      const n = amt ? parseInt((amt.textContent || '').replace(/[^\d]/g, ''), 10) : NaN;
      if (!isNaN(n)) extra += n;
    });
    return extra;
  }

  function offerTotals(offer) {
    let rap = 0;
    let val = 0;
    let known = 0;
    let total = 0;
    offer.querySelectorAll('.item-card-caption').forEach((c) => {
      total++;
      const r = c.dataset.bloxSuiteRap;
      const v = c.dataset.bloxSuiteVal;
      if (r === undefined && v === undefined) return;
      known++;
      const rapN = r !== undefined ? parseInt(r, 10) : 0;
      rap += rapN;
      val += v !== undefined ? parseInt(v, 10) : rapN;
    });
    const robux = offerRobux(offer);
    return {
      rap: rap,
      value: val + robux,
      robux: robux,
      complete: known === total && total > 0,
    };
  }

  function pctText(diff, base) {
    if (!base) return '';
    const p = (diff / base) * 100;
    const sign = p > 0 ? '+' : p < 0 ? '\u2212' : '';
    return sign + Math.abs(p).toFixed(1) + '%';
  }

  function applyTradeTotals() {
    if (!store.get('enabled') || !store.get('valuesEnabled')) return;
    const offers = document.querySelectorAll('.trade-list-detail-offer');
    if (offers.length < 2) return;

    let gave = null;
    let received = null;
    offers.forEach((offer) => {
      const head = offer.querySelector('.trade-list-detail-offer-header');
      const t = offerTotals(offer);
      if (!t.complete) return;
      const isGave = head && /\b(gave|give)\b/i.test(head.textContent);
      if (isGave) gave = t; else received = t;

      const box = offer.querySelector('.robux-line') && offer.querySelector('.robux-line').parentElement;
      if (!box || box.dataset.bloxSuiteTotals === '1') return;
      box.dataset.bloxSuiteTotals = '1';
      box.appendChild(tradeLine('BloxSuite RAP:', formatRobux(t.rap), null));
      box.appendChild(tradeLine('BloxSuite Value:', formatRobux(t.value), null, true));
    });

    if (!gave || !received) return;
    const last = offers[offers.length - 1];
    const box = last.querySelector('.robux-line') && last.querySelector('.robux-line').parentElement;
    if (!box || box.dataset.bloxSuiteNet === '1') return;
    box.dataset.bloxSuiteNet = '1';
    const rapDiff = received.rap - gave.rap;
    const valDiff = received.value - gave.value;
    box.appendChild(tradeLine('RAP Difference:', signedText(rapDiff), rapDiff, false, pctText(rapDiff, gave.rap)));
    box.appendChild(tradeLine('Value Difference:', signedText(valDiff), valDiff, true, pctText(valDiff, gave.value)));
  }

  function tradeLine(label, text, diff, useIcon, pct) {
    const row = document.createElement('div');
    row.className = 'robux-line blox-suite-trade-line';
    row.dataset.bloxSuiteValue = '1';
    const l = document.createElement('span');
    l.className = 'text-lead';
    l.textContent = label;
    const amt = document.createElement('span');
    amt.className = 'robux-line-amount';
    const v = document.createElement('span');
    v.className = 'text-robux-lg robux-line-value blox-suite-vtext';
    if (diff !== null && diff !== undefined) v.classList.add(diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat');
    v.textContent = text;
    amt.appendChild(v);
    const ref = document.querySelector('.robux-line:not(.blox-suite-trade-line) .robux-line-value');
    if (ref) matchFontFrom(ref, v);
    if (pct) {
      const p = document.createElement('span');
      p.className = 'blox-suite-pct blox-suite-vtext';
      if (diff !== null && diff !== undefined) p.classList.add(diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat');
      p.textContent = '(' + pct + ')';
      amt.appendChild(p);
    }
    row.appendChild(l);
    row.appendChild(amt);
    return row;
  }

  function statPill(label, href) {
    const a = document.createElement(href ? 'a' : 'span');
    a.className = 'relative clip group/interactable focus-visible:outline-focus cursor-pointer flex justify-center items-center radius-circle stroke-none padding-left-medium padding-right-medium height-800 text-label-medium bg-shift-300 content-action-utility blox-suite-stat-pill';
    a.dataset.bloxSuiteStat = '1';
    if (href) {
      a.href = href;
      a.style.textDecoration = 'none';
      const layer = document.createElement('div');
      layer.setAttribute('aria-hidden', 'true');
      layer.setAttribute('data-testid', 'foundation-web-state-layer');
      layer.className = 'absolute inset-[0] transition-colors group-hover/interactable:bg-[var(--color-state-hover)] group-active/interactable:bg-[var(--color-state-press)]';
      a.appendChild(layer);
    }
    const inner = document.createElement('span');
    inner.className = 'padding-y-xsmall text-no-wrap text-truncate-end blox-suite-pill-text';
    inner.textContent = label;
    a.appendChild(inner);
    return a;
  }

  function applyProfileStats() {
    if (!store.get('enabled') || !store.get('valuesEnabled')) return;
    const uid = currentProfileUserId();
    if (!uid) return;
    const row = document.querySelector('.user-profile-header .flex-nowrap.gap-small.flex') ||
          document.querySelector('.flex-nowrap.gap-small.flex');
    if (!row || row.dataset.bloxSuiteStats === '1') return;
    if (!row.querySelector('a[href*="/friends"]')) return;
    row.dataset.bloxSuiteStats = '1';
    const href = 'https://www.roblox.com/users/' + uid + '/inventory';
    const rapPill = statPill('RAP \u2026', href);
    const valPill = statPill('Value \u2026', href);
    row.appendChild(rapPill);
    row.appendChild(valPill);
    getInventoryValue(uid).then((inv) => {
      if (!inv) {
        rapPill.remove();
        valPill.remove();
        delete row.dataset.bloxSuiteStats;
        return;
      }
      rapPill.querySelector('.blox-suite-pill-text').textContent = formatRobux(inv.rap) + ' RAP';
      valPill.querySelector('.blox-suite-pill-text').textContent = formatRobux(inv.value) + ' Value';
    });
  }

  function applyHideSerials() {
    if (!store.get('enabled') || !store.get('hideSerials')) return;
    document.querySelectorAll('.limited-number-container').forEach((el) => {
      if (el.dataset.bloxSuiteHidden === '1') return;
      el.dataset.bloxSuiteHidden = '1';
      el.dataset.bloxSuiteDisplay = el.style.display || '';
      el.style.display = 'none';
    });
    document.querySelectorAll('.item-serial-number, [class*="serial-number"]').forEach((el) => {
      if (el.dataset.bloxSuiteHidden === '1') return;
      el.dataset.bloxSuiteHidden = '1';
      el.dataset.bloxSuiteDisplay = el.style.display || '';
      el.style.display = 'none';
    });
  }

  function revertHideSerials() {
    document.querySelectorAll('.limited-number-container[data-blox-suite-hidden="1"], .item-serial-number[data-blox-suite-hidden="1"], [class*="serial-number"][data-blox-suite-hidden="1"]').forEach((el) => {
      el.style.display = el.dataset.bloxSuiteDisplay || '';
      delete el.dataset.bloxSuiteHidden;
      delete el.dataset.bloxSuiteDisplay;
    });
  }

  function revertValueCards() {
    document.querySelectorAll('[data-blox-suite-value="1"], [data-blox-suite-stat="1"]').forEach((el) => el.remove());
    document.querySelectorAll('[data-blox-suite-value-host="1"]').forEach((el) => delete el.dataset.bloxSuiteValueHost);
    document.querySelectorAll('[data-blox-suite-card="1"]').forEach((el) => {
      delete el.dataset.bloxSuiteCard;
      delete el.dataset.bloxSuiteRap;
      delete el.dataset.bloxSuiteVal;
      delete el.dataset.bloxSuiteExact;
    });
    document.querySelectorAll('[data-blox-suite-stats="1"]').forEach((el) => delete el.dataset.bloxSuiteStats);
    document.querySelectorAll('[data-blox-suite-totals="1"]').forEach((el) => delete el.dataset.bloxSuiteTotals);
    document.querySelectorAll('[data-blox-suite-net="1"]').forEach((el) => delete el.dataset.bloxSuiteNet);
  }

  function pickTileToReplace(list) {
    const candidates = [].slice.call(list.children).filter((c) => {
      if (c.hasAttribute('data-blox-suite-friend')) return false;
      if (c.dataset.bloxSuiteReplaced === '1') return false;
      if (c.querySelector('a[href*="friend-requests"]')) return false;
      if (!c.querySelector('.friends-carousel-tile')) return false;
      return true;
    });
    if (!candidates.length) return null;
    const offline = candidates.filter((c) => !c.querySelector('[data-testid="presence-icon"]'));
    if (offline.length) return offline[0];
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  function isOwnFriendsSurface() {
    if (/^\/home\/?$/.test(location.pathname)) return true;
    const profileId = currentProfileUserId();
    if (!profileId) return false;
    const uid = ownUserId || detectOwnUserId();
    return !!uid && profileId === uid;
  }

  function applyFakeFriends() {
    const ids = store.get('fakeFriends') || [];
    if (!store.get('enabled') || !ids.length) return;
    if (!isOwnFriendsSurface()) return;
    const list = document.querySelector('.friends-carousel-list-container');
    if (!list) return;
    ids.forEach((id) => {
      const data = friendCache[id];
      if (!data) {
        fetchFriendData(id).then((d) => { if (d) applyFakeFriends(); });
        return;
      }
      if (list.querySelector('[data-blox-suite-friend="' + id + '"]')) return;
      const tile = buildFriendTile(data);
      const target = pickTileToReplace(list);
      if (target) {
        target.dataset.bloxSuiteReplaced = '1';
        target.dataset.bloxSuiteDisplay = target.style.display || '';
        target.style.display = 'none';
        list.insertBefore(tile, target);
      } else {
        list.insertBefore(tile, list.firstChild);
      }
    });
  }

  function revertFakeFriends() {
    document.querySelectorAll('[data-blox-suite-friend]').forEach((el) => el.remove());
    document.querySelectorAll('[data-blox-suite-replaced="1"]').forEach((el) => {
      el.style.display = el.dataset.bloxSuiteDisplay || '';
      delete el.dataset.bloxSuiteReplaced;
      delete el.dataset.bloxSuiteDisplay;
    });
  }

  function applyHomeGreeting() {
    if (!store.get('enabled') || !store.get('greetingEnabled')) return;
    if (!/^\/home\/?$/.test(location.pathname)) return;
    const h1 = document.querySelector('.container-header h1');
    if (!h1) return;
    const name = getOwnDisplayName();
    if (!name) return;
    const want = 'Hello, ' + name;
    if (h1.dataset.bloxSuiteReal === undefined) h1.dataset.bloxSuiteReal = h1.textContent;
    if (h1.textContent !== want) h1.textContent = want;
  }

  function revertHomeGreeting() {
    document.querySelectorAll('.container-header h1[data-blox-suite-real]').forEach((h1) => {
      h1.textContent = h1.dataset.bloxSuiteReal;
      delete h1.dataset.bloxSuiteReal;
    });
  }

  function getOwnDisplayName() {
    const navName = document.querySelector('#navigation .font-header-2.dynamic-ellipsis-item');
    if (navName && navName.textContent.trim()) return navName.textContent.trim();
    const headerName = document.querySelector('#profile-header-title-container-name');
    if (headerName && headerName.textContent.trim()) return headerName.textContent.trim();
    return null;
  }
  const DEMAND_LABELS = ['Terrible', 'Low', 'Normal', 'High', 'Amazing'];
  const TREND_LABELS = ['Lowering', 'Unstable', 'Stable', 'Raising', 'Fluctuating'];

  let rolimonsPromise = null;

  function gmRequestRaw(url) {
    return new Promise((resolve) => {
      const gm = typeof GM_xmlhttpRequest === 'function' ? GM_xmlhttpRequest
        : (typeof GM !== 'undefined' && GM && typeof GM.xmlHttpRequest === 'function' ? GM.xmlHttpRequest : null);
      if (!gm) return resolve({ ok: false, reason: 'nogm', detail: 'GM_xmlhttpRequest not available' });
      let done = false;
      const finish = (r) => { if (!done) { done = true; resolve(r); } };
      try {
        gm({
          method: 'GET',
          url: url,
          headers: { 'Accept': 'application/json, text/html' },
          onload: (r) => finish({ ok: r.status === 200, reason: 'http', status: r.status, body: r.responseText }),
          onerror: (e) => finish({ ok: false, reason: 'refused', detail: (e && (e.error || e.statusText)) || 'blocked before sending' }),
          ontimeout: () => finish({ ok: false, reason: 'timeout' }),
          timeout: 20000,
        });
      } catch (e) {
        finish({ ok: false, reason: 'threw', detail: e && e.message ? e.message : String(e) });
      }
    });
  }

  function describeResult(url, res) {
    const host = url.replace(/^https?:\/\//, '').split('/')[0];
    if (res.reason === 'nogm') return host + ': GM_xmlhttpRequest unavailable';
    if (res.reason === 'refused') return host + ': refused (' + res.detail + ')';
    if (res.reason === 'timeout') return host + ': timed out';
    if (res.reason === 'threw') return host + ': error - ' + res.detail;
    return host + ': HTTP ' + res.status;
  }

  function gmRequest(url) {
    return gmRequestRaw(url).then((res) => {
      if (!res.ok) {
        roliError = describeResult(url, res);
        console.warn('[Blox Suite] ' + roliError);
        return null;
      }
      try {
        return JSON.parse(res.body);
      } catch (e) {
        roliError = describeResult(url, res) + ' but the body was not JSON (Cloudflare challenge?)';
        console.warn('[Blox Suite] ' + roliError);
        return null;
      }
    });
  }

  function runConnectivityTest() {
    const targets = [
      ['https://users.roblox.com/v1/users/1', 'roblox (listed in @connect)'],
      ['https://api.rolimons.com/items/v1/itemdetails', 'rolimons api (listed in @connect)'],
      ['https://www.rolimons.com/itemapi/itemdetails', 'rolimons www (listed in @connect)'],
      ['https://example.com/', 'control (NOT listed - should be refused)'],
    ];
    return Promise.all(targets.map((t) => gmRequestRaw(t[0]).then((r) => ({ res: r, url: t[0], note: t[1] }))))
      .then((rows) => {
        const lines = rows.map((r) => describeResult(r.url, r.res) + '  <- ' + r.note);
        const reached = (r) => r.res.reason === 'http';
        const roblox = reached(rows[0]);
        const roli = reached(rows[1]) || reached(rows[2]);
        const controlRefused = !reached(rows[3]);
        let verdict;
        if (roli) {
          verdict = 'VERDICT: rolimons responded. If values still do not show, press Retry.';
        } else if (!roblox) {
          verdict = 'VERDICT: nothing got through, so GM_xmlhttpRequest is not working at all.\nThis is expected in Falkon, which has no GM API. Use Firefox with Tampermonkey.';
        } else if (controlRefused) {
          verdict = 'VERDICT: @connect is still being enforced against rolimons even though this\nscript now uses "@connect *". Tampermonkey keeps the OLD permission set when a\nscript is edited rather than reinstalled, so the wildcard has not taken effect.\nFix: delete Blox Suite in the Tampermonkey dashboard, install it fresh, and\naccept the prompt. Or set it manually under script Settings > User domain whitelist.';
        } else {
          verdict = 'VERDICT: unlisted domains get through but rolimons does not, so something outside\nTampermonkey is blocking it - uBlock Origin, a DNS blocklist (Pi-hole, NextDNS,\nAdGuard Home), or your router/ISP. Open\nhttps://api.rolimons.com/items/v1/itemdetails in a normal tab: if that also fails,\nit is network-level. You can still use Import below.';
        }
        return lines.join('\n') + '\n\n' + verdict;
      });
  }

  const ROLI_CACHE_KEY = 'bloxSuiteRoli';
  const ROLI_TTL = 30 * 60 * 1000;
  let rolimonsStatus = 'idle';
  let roliError = null;

  function readRoliCache() {
    try {
      const raw = GM_getValue(ROLI_CACHE_KEY, null) || localStorage.getItem(ROLI_CACHE_KEY);
      if (!raw) return null;
      const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!obj || !obj.t || !obj.items) return null;
      if (Date.now() - obj.t > ROLI_TTL) return null;
      return obj.items;
    } catch (e) {
      return null;
    }
  }

  function writeRoliCache(items) {
    const trimmed = {};
    Object.keys(items).forEach((id) => {
      const r = items[id];
      trimmed[id] = [r[0], r[1], r[2], r[3], 0, r[5], r[6], r[7], r[8], r[9]];
    });
    const payload = JSON.stringify({ t: Date.now(), items: trimmed });
    try { GM_setValue(ROLI_CACHE_KEY, payload); } catch (e) {}
    try { localStorage.setItem(ROLI_CACHE_KEY, payload); } catch (e) {}
  }

  function getRolimons() {
    if (rolimonsPromise) return rolimonsPromise;
    const cached = readRoliCache();
    if (cached) {
      rolimonsStatus = 'cached';
      roliNameIndex = null;
      rolimonsPromise = Promise.resolve(cached);
      return rolimonsPromise;
    }
    const endpoints = [
      'https://api.rolimons.com/items/v1/itemdetails',
      'https://www.rolimons.com/itemapi/itemdetails',
    ];

    const attempts = [];
    rolimonsPromise = endpoints.reduce(
      (chain, url) => chain.then((prev) => {
        if (prev && prev.items) return prev;
        return gmRequest(url).then((r) => {
          if (!r) attempts.push(roliError);
          return r;
        });
      }),
      Promise.resolve(null)
    ).then((json) => {
      if (!json || !json.items) {
        rolimonsStatus = 'failed';
        roliError = attempts.join(' | ');
        return null;
      }
      rolimonsStatus = 'live';
      roliError = null;
      roliNameIndex = null;
      const n = Object.keys(json.items).length;
      console.log('[Blox Suite] Rolimons loaded, ' + n + ' items.');
      writeRoliCache(json.items);
      return json.items;
    });
    return rolimonsPromise;
  }

  function readRolimonEntry(items, assetId) {
    const row = items && items[String(assetId)];
    if (!row) return null;
    const value = row[3] > 0 ? row[3] : null;
    return {
      name: row[0],
      acronym: row[1] || '',
      rap: row[2] > 0 ? row[2] : null,
      value: value,
      demand: row[5] >= 0 ? DEMAND_LABELS[row[5]] : null,
      trend: row[6] >= 0 ? TREND_LABELS[row[6]] : null,
      projected: row[7] === 1,
      hyped: row[8] === 1,
      rare: row[9] === 1,
      fromRolimons: true,
    };
  }

  let roliNameIndex = null;

  function normaliseName(s) {
    return (s || '').toLowerCase().replace(/[\u2018\u2019']/g, "'").replace(/\s+/g, ' ').trim();
  }

  function buildNameIndex(items) {
    const idx = {};
    Object.keys(items).forEach((id) => {
      const row = items[id];
      const n = normaliseName(row[0]);
      if (n && idx[n] === undefined) idx[n] = id;
      const acr = normaliseName(row[1]);
      if (acr && idx['@' + acr] === undefined) idx['@' + acr] = id;
    });
    return idx;
  }

  function readRolimonByName(items, name) {
    if (!items || !name) return null;
    if (!roliNameIndex) roliNameIndex = buildNameIndex(items);
    const key = normaliseName(name);
    const id = roliNameIndex[key] !== undefined ? roliNameIndex[key] : roliNameIndex['@' + key];
    if (id === undefined) return null;
    return readRolimonEntry(items, id);
  }

  function getItemValue(id, name) {
    return getRolimons().then((items) => {
      if (!items) return null;
      const byId = readRolimonEntry(items, id);
      if (byId) {
        byId.matchedBy = 'id';
        return byId;
      }
      const byName = readRolimonByName(items, name);
      if (byName) byName.matchedBy = 'name';
      return byName;
    });
  }

  function fetchCollectiblesPage(uid, cursor) {
    const url = 'https://inventory.roblox.com/v1/users/' + uid + '/assets/collectibles?sortOrder=Asc&limit=100' +
      (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
    return apiGet(url);
  }

  function fetchAllCollectibles(uid) {
    const out = [];
    function step(cursor) {
      return fetchCollectiblesPage(uid, cursor).then((res) => {
        if (!res || !res.data) return out;
        res.data.forEach((it) => out.push(it));
        if (res.nextPageCursor && out.length < 2000) return step(res.nextPageCursor);
        return out;
      });
    }
    return step(null);
  }
  const inventoryCache = {};

  function getInventoryValue(targetUid) {
    const uid = targetUid || ownUserId || detectOwnUserId();
    if (!uid) return Promise.resolve(null);
    if (inventoryCache[uid]) return inventoryCache[uid];
    inventoryCache[uid] = Promise.all([fetchAllCollectibles(uid), getRolimons()]).then((res) => {
      const items = res[0] || [];
      const rolimons = res[1];
      let rapTotal = 0;
      let valueTotal = 0;
      items.forEach((it) => {
        const rap = typeof it.recentAveragePrice === 'number' ? it.recentAveragePrice : 0;
        const entry = readRolimonEntry(rolimons, it.assetId);
        const value = entry && entry.value !== null ? entry.value : rap;
        rapTotal += rap;
        valueTotal += value;
      });
      return { count: items.length, rap: rapTotal, value: valueTotal };
    });
    return inventoryCache[uid];
  }

  function currentCatalogItem() {
    const bundle = location.pathname.match(/^\/bundles\/(\d+)/);
    if (bundle) return { type: 'Bundle', id: bundle[1] };
    const asset = location.pathname.match(/^\/(?:catalog|library)\/(\d+)/);
    if (asset) return { type: 'Asset', id: asset[1] };
    return null;
  }

  function parseRobuxText(text) {
    const t = (text || '').trim();
    const m = t.match(/([\d,.]+)\s*([KMBT])\+?/i);
    if (m) {
      const mult = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[m[2].toUpperCase()];
      const base = parseFloat(m[1].replace(/,/g, ''));
      if (!isNaN(base)) return Math.floor(base * mult);
    }
    const digits = t.replace(/[^\d]/g, '');
    return digits === '' ? null : parseInt(digits, 10);
  }

  function readLiveRobux() {
    const nav = document.querySelector('#nav-robux-amount');
    if (nav && nav.dataset.bloxSuitePatched !== '1') {
      const v = parseRobuxText(nav.textContent);
      if (v !== null) return v;
    }
    const label = document.querySelector('.balance-label.icon-robux-container span');
    if (label && label.dataset.bloxSuitePatched !== '1') {
      const node = findBalanceTextNode(label);
      if (node) {
        const v = parseRobuxText(node.textContent);
        if (v !== null) return v;
      }
    }
    return null;
  }

  function isOwnContext(el, uid) {
    if (!uid) return false;
    const uidRe = new RegExp('/users/' + uid + '(/|$|\\?|#)');
    const numericRe = /\/users\/\d+/;
    const direct = el.closest('a[href*="/users/"]');
    if (direct && numericRe.test(direct.getAttribute('href') || '')) return uidRe.test(direct.getAttribute('href') || '');
    let node = el.parentElement;
    while (node && node !== document.body) {
      const links = [].slice.call(node.querySelectorAll('a[href*="/users/"]'))
        .filter((l) => numericRe.test(l.getAttribute('href') || ''));
      if (links.length) {
        for (const l of links) {
          if (uidRe.test(l.getAttribute('href') || '')) return true;
        }
        return false;
      }
      node = node.parentElement;
    }
    return new RegExp('^/users/' + uid + '(/|$)').test(location.pathname);
  }
  const realTextNodes = new WeakMap();

  function findBalanceTextNode(wrapper) {
    let found = null;
    for (const node of wrapper.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && /\d/.test(node.textContent)) {
        found = node;
      }
    }
    return found;
  }

  function applyRobuxDisplay() {
    if (!store.get('enabled') || !store.get('robuxEnabled')) {
      const v = readLiveRobux();
      if (v !== null) liveRobux = v;
      return;
    }
    const target = store.get('robuxValue');
    if (target === null) return;
    const formatted = formatRobux(target);
    const short = abbreviateRobux(target);
    document.querySelectorAll('#nav-robux-amount').forEach((el) => {
      if (el.dataset.bloxSuitePatched !== '1') {
        const v = parseRobuxText(el.textContent);
        if (v !== null && liveRobux === null) liveRobux = v;
        el.dataset.bloxSuiteReal = el.textContent;
        el.dataset.bloxSuitePatched = '1';
      }
      if (el.textContent !== short) el.textContent = short;
    });
    document.querySelectorAll('.balance-label.icon-robux-container span').forEach((wrapper) => {
      const node = findBalanceTextNode(wrapper);
      if (!node) return;
      if (!realTextNodes.has(node)) {
        const v = parseRobuxText(node.textContent);
        if (v !== null && liveRobux === null) liveRobux = v;
        realTextNodes.set(node, node.textContent);
        wrapper.dataset.bloxSuitePatched = '1';
      }
      if (node.textContent !== formatted) {
        node.textContent = formatted;
      }
    });
  }

  function revertRobuxDisplay() {
    document.querySelectorAll('#nav-robux-amount[data-blox-suite-patched="1"]').forEach((el) => {
      if (el.dataset.bloxSuiteReal !== undefined) el.textContent = el.dataset.bloxSuiteReal;
      delete el.dataset.bloxSuitePatched;
      delete el.dataset.bloxSuiteReal;
    });
    document.querySelectorAll('.balance-label.icon-robux-container span[data-blox-suite-patched="1"]').forEach((wrapper) => {
      for (const node of wrapper.childNodes) {
        if (node.nodeType === Node.TEXT_NODE && realTextNodes.has(node)) {
          node.textContent = realTextNodes.get(node);
          realTextNodes.delete(node);
        }
      }
      delete wrapper.dataset.bloxSuitePatched;
      delete wrapper.dataset.bloxSuiteReal;
    });
  }

  function buildVerifiedBadge(sizeVar) {
    const wrap = document.createElement('span');
    wrap.className = 'relative flex items-center justify-center';
    wrap.dataset.bloxSuiteBadge = '1';
    const backplate = document.createElement('span');
    backplate.setAttribute('aria-hidden', 'true');
    backplate.setAttribute('data-testid', 'foundation-web-icon');
    backplate.className = 'grow-0 shrink-0 basis-auto icon icon-filled-verified-backplate size-[var(' + sizeVar + ')] content-system-emphasis';
    const check = document.createElement('span');
    check.setAttribute('aria-hidden', 'true');
    check.setAttribute('data-testid', 'foundation-web-icon');
    check.setAttribute('aria-label', 'Verified');
    check.className = 'grow-0 shrink-0 basis-auto icon icon-filled-verified-check size-[var(' + sizeVar + ')] absolute';
    check.style.color = 'white';
    wrap.appendChild(backplate);
    wrap.appendChild(check);
    return wrap;
  }

  function applyVerifiedBadge() {
    if (!store.get('enabled') || !store.get('verifiedEnabled')) return;
    const uid = detectOwnUserId();
    if (!uid) return;
    document.querySelectorAll(PLUS_ICON_SELECTOR).forEach((iconSpan) => {
      if (iconSpan.dataset.bloxSuiteHidden === '1') return;
      if (!isOwnContext(iconSpan, uid)) return;
      const sizeVar = /size-\[var\(--icon-size-large\)\]/.test(iconSpan.className)
        ? '--icon-size-large'
        : '--icon-size-small';
      const badge = buildVerifiedBadge(sizeVar);
      iconSpan.dataset.bloxSuiteHidden = '1';
      iconSpan.style.display = 'none';
      iconSpan.insertAdjacentElement('afterend', badge);
    });
  }

  function revertVerifiedBadge() {
    document.querySelectorAll('span[data-blox-suite-badge="1"]').forEach((b) => b.remove());
    document.querySelectorAll('span[data-blox-suite-hidden="1"]').forEach((iconSpan) => {
      iconSpan.style.display = '';
      delete iconSpan.dataset.bloxSuiteHidden;
    });
  }

  function runAllPatches() {
    applyThemeTokens();
    detectOwnUserId();
    applyRobuxDisplay();
    applyHomeGreeting();
    applyFakeFriends();
    applyFriendProfile();
    applyItemValue();
    applyItemCardValues();
    applyTradeTotals();
    applyProfileStats();
    applyHideSerials();
    if (store.get('enabled') && store.get('verifiedEnabled')) {
      applyVerifiedBadge();
    }
  }

  function startObserver() {
    const observer = new MutationObserver(() => {
      runAllPatches();
      tryInjectMenuItem();
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  function tryInjectMenuItem() {
    const menu = document.getElementById('settings-popover-menu');
    if (!menu || menu.dataset.bloxSuiteInjected === '1') return;
    const quickSignIn = menu.querySelector('a[href="https://www.roblox.com/crossdevicelogin/ConfirmCode"]');
    if (!quickSignIn) return;
    const quickSignInLi = quickSignIn.closest('li');
    if (!quickSignInLi) return;
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.className = 'rbx-menu-item';
    a.href = '#';
    a.textContent = 'Suite Settings';
    a.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openSettingsModal();
      document.body.click();
    });
    li.appendChild(a);
    quickSignInLi.insertAdjacentElement('afterend', li);
    menu.dataset.bloxSuiteInjected = '1';
  }

  let modalRoot = null;

  function injectStyles() {
    if (document.getElementById('blox-suite-styles')) return;
    const style = document.createElement('style');
    style.id = 'blox-suite-styles';
    style.textContent = `
        .blox-suite-overlay { position: fixed; inset: 0; background: var(--bs-overlay, rgba(0,0,0,0.5)); z-index: 999999; display: flex; align-items: center; justify-content: center; font-family: "Builder Sans", "Source Sans Pro", "Helvetica Neue", Helvetica, Arial, sans-serif; animation: blox-suite-fade-in 0.15s ease-out; }
        @keyframes blox-suite-fade-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes blox-suite-pop-in { from { opacity: 0; transform: translateY(8px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
        .blox-suite-modal { width: 460px; max-width: 94vw; max-height: 86vh; display: flex; flex-direction: column; background: var(--bs-surface, #fff); color: var(--bs-text, #393b3d); border: 1px solid var(--bs-border, rgba(0,0,0,0.1)); border-radius: 12px; box-shadow: 0 12px 40px rgba(0,0,0,0.35); animation: blox-suite-pop-in 0.16s ease-out; overflow: hidden; }
        .blox-suite-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px 0; }
        .blox-suite-header-title { display: flex; align-items: center; gap: 8px; font-size: 17px; font-weight: 700; }
        .blox-suite-ver { font-size: 11px; font-weight: 400; opacity: 0.55; margin-left: 2px; }
        .blox-suite-header-title .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--bs-accent, #00a2ff); display: inline-block; }
        .blox-suite-close { background: none; border: none; cursor: pointer; color: var(--bs-muted, #9b9b9b); font-size: 16px; line-height: 1; padding: 6px; border-radius: 6px; }
        .blox-suite-close:hover { background: var(--bs-panel, rgba(0,0,0,0.05)); color: var(--bs-text, #393b3d); }
        .blox-suite-tabs { display: flex; gap: 4px; padding: 12px 20px 0; border-bottom: 1px solid var(--bs-border, rgba(0,0,0,0.1)); }
        .blox-suite-tab { background: none; border: none; cursor: pointer; font: inherit; font-size: 14px; font-weight: 600; color: var(--bs-muted, #9b9b9b); padding: 8px 12px; border-bottom: 2px solid transparent; margin-bottom: -1px; }
        .blox-suite-tab:hover { color: var(--bs-text, #393b3d); }
        .blox-suite-tab.active { color: var(--bs-text, #393b3d); border-bottom-color: var(--bs-accent, #00a2ff); }
        .blox-suite-body { padding: 4px 20px 16px; overflow-y: auto; flex: 1; }
        .blox-suite-page { display: none; }
        .blox-suite-page.active { display: block; }
        .blox-suite-page.disabled { opacity: 0.4; pointer-events: none; }
        .blox-suite-master-row { display: flex; align-items: center; justify-content: space-between; padding: 14px 0; border-bottom: 1px solid var(--bs-border, rgba(0,0,0,0.1)); }
        .blox-suite-section { padding: 16px 0; border-bottom: 1px solid var(--bs-border, rgba(0,0,0,0.1)); transition: opacity 0.15s ease; }
        .blox-suite-section:last-child { border-bottom: none; }
        .blox-suite-section.disabled { opacity: 0.4; pointer-events: none; }
        .blox-suite-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
        .blox-suite-row .label, .blox-suite-master-row .label { font-size: 14px; font-weight: 600; }
        .blox-suite-row .sublabel, .blox-suite-master-row .sublabel { font-size: 12px; color: var(--bs-muted, #9b9b9b); margin-top: 2px; }
        .blox-suite-input-row { margin-top: 10px; display: flex; align-items: center; gap: 8px; }
        .blox-suite-input-wrap { position: relative; flex: 1; }
        .blox-suite-robux-icon { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); width: 14px; height: 14px; }
        .blox-suite-input { width: 100%; box-sizing: border-box; padding: 9px 10px; border: 1px solid var(--bs-border, #ccc); border-radius: 8px; font: inherit; font-size: 14px; background: var(--bs-panel, transparent); color: var(--bs-text, #393b3d); outline: none; }
        .blox-suite-input.has-icon { padding-left: 30px; }
        .blox-suite-input:focus { border-color: var(--bs-accent, #00a2ff); }
        .blox-suite-input::placeholder { color: var(--bs-muted, #9b9b9b); }
        .blox-suite-preview { font-size: 11px; color: var(--bs-muted, #9b9b9b); margin-top: 6px; }
        .blox-suite-preview b { color: var(--bs-text, #393b3d); }
        .blox-suite-switch { position: relative; display: inline-block; width: 40px; height: 22px; flex-shrink: 0; }
        .blox-suite-switch input { opacity: 0; width: 0; height: 0; }
        .blox-suite-switch .slider { position: absolute; cursor: pointer; inset: 0; background-color: var(--bs-border, #d4d4d4); border-radius: 999px; transition: background-color 0.15s ease; }
        .blox-suite-switch .slider::before { content: ""; position: absolute; width: 18px; height: 18px; left: 2px; top: 2px; background-color: #fff; border-radius: 50%; transition: transform 0.15s ease; box-shadow: 0 1px 2px rgba(0,0,0,0.25); }
        .blox-suite-switch input:checked + .slider { background-color: var(--bs-accent, #00a2ff); }
        .blox-suite-switch input:checked + .slider::before { transform: translateX(18px); }
        .blox-suite-add-row { display: flex; gap: 8px; margin: 14px 0 4px; }
        .blox-suite-add-btn { background: var(--bs-accent, #00a2ff); color: var(--bs-accent-text, #fff); border: none; padding: 0 16px; border-radius: 8px; font: inherit; font-size: 14px; font-weight: 700; cursor: pointer; flex-shrink: 0; }
        .blox-suite-add-btn:disabled { opacity: 0.5; cursor: default; }
        .blox-suite-hint { font-size: 12px; color: var(--bs-muted, #9b9b9b); margin-bottom: 10px; }
        .blox-suite-hint.error { color: #e02c2c; }
        .blox-suite-diag { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 11px; line-height: 1.5; white-space: pre-wrap; background: var(--bs-panel, rgba(0,0,0,0.04)); border: 1px solid var(--bs-border, rgba(0,0,0,0.1)); border-radius: 8px; padding: 10px; margin-top: 8px; color: var(--bs-text, #393b3d); max-height: 220px; overflow: auto; }
        .blox-suite-friend-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
        .blox-suite-friend { display: flex; align-items: center; gap: 10px; padding: 8px; border-radius: 8px; background: var(--bs-panel, rgba(0,0,0,0.03)); }
        .blox-suite-friend img { width: 34px; height: 34px; border-radius: 50%; flex-shrink: 0; background: var(--bs-border, #ddd); object-fit: cover; }
        .blox-suite-friend-meta { min-width: 0; flex: 1; }
        .blox-suite-friend-name { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center; gap: 4px; }
        .blox-suite-friend-sub { font-size: 12px; color: var(--bs-muted, #9b9b9b); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .blox-suite-presence { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
        .blox-suite-presence.online { background: #00b06f; }
        .blox-suite-presence.game { background: #00a2ff; }
        .blox-suite-presence.studio { background: #f5a623; }
        .blox-suite-presence.offline { background: var(--bs-border, #bbb); }
        .blox-suite-remove { background: none; border: none; cursor: pointer; color: var(--bs-muted, #9b9b9b); font-size: 15px; padding: 6px; border-radius: 6px; flex-shrink: 0; }
        .blox-suite-remove:hover { background: var(--bs-border, rgba(0,0,0,0.08)); color: #e02c2c; }
        .blox-suite-empty { font-size: 13px; color: var(--bs-muted, #9b9b9b); text-align: center; padding: 26px 10px; border: 1px dashed var(--bs-border, rgba(0,0,0,0.15)); border-radius: 10px; }
        .blox-suite-value-line { display: flex; align-items: baseline; gap: 6px; margin-top: 2px; font-family: inherit; }
        .blox-suite-value-line.compact { margin-top: 0; }
        .blox-suite-vlab { font-size: 0.75em; opacity: 0.7; font-weight: 400; }
        .blox-suite-item-values { margin-top: 6px; display: flex; flex-direction: column; gap: 2px; }
        .blox-suite-vtext { font-family: inherit !important; font-size: inherit; font-weight: 700; line-height: 1.2; font-variant-numeric: normal !important; font-feature-settings: normal !important; color: #00A2FF; }
        .blox-suite-vtext.muted { opacity: 0.6; font-weight: 400; }
        .blox-suite-pct { font-size: 0.8em !important; font-weight: 600 !important; margin-left: 6px; opacity: 0.95; }
        .blox-suite-vtext.up { color: #02b757 !important; }
        .blox-suite-vtext.down { color: #f14e4e !important; }
        .blox-suite-trade-line .blox-suite-vtext { color: #00A2FF; }
        .blox-suite-stat-pill { cursor: default; }
        .blox-suite-footer { padding: 12px 20px 16px; display: flex; justify-content: flex-end; align-items: center; border-top: 1px solid var(--bs-border, rgba(0,0,0,0.1)); }
        .blox-suite-save-btn { background: var(--bs-accent, #00a2ff); color: var(--bs-accent-text, #fff); border: none; padding: 9px 20px; border-radius: 8px; font: inherit; font-size: 14px; font-weight: 700; cursor: pointer; }
        .blox-suite-saved-toast { font-size: 12px; color: #00b06f; margin-right: 12px; opacity: 0; transition: opacity 0.2s ease; }
        .blox-suite-saved-toast.show { opacity: 1; }
        `;
    (document.head || document.documentElement).appendChild(style);
  }

  function svgRobuxIcon() {
    return `<svg class="blox-suite-robux-icon" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
            <path fill="#00a2ff" d="M8 0 L15 4 V12 L8 16 L1 12 V4 Z" opacity="0.15"/>
            <path fill="#393b3d" d="M8 1.2 L14 4.6 V11.4 L8 14.8 L2 11.4 V4.6 Z" opacity="0"/>
            <path fill="#393b3d" d="M8 2 L13.5 5 V11 L8 14 L2.5 11 V5 Z"/>
            <path fill="#ffffff" d="M8 4.2 L11.3 6.1 V9.9 L8 11.8 L4.7 9.9 V6.1 Z"/>
        </svg>`;
  }

  function buildModal() {
    injectStyles();
    const overlay = document.createElement('div');
    overlay.className = 'blox-suite-overlay';
    overlay.id = 'blox-suite-overlay';
    const enabled = store.get('enabled');
    const robuxEnabled = store.get('robuxEnabled');
    const saved = store.get('robuxValue');
    if (liveRobux === null) {
      const v = readLiveRobux();
      if (v !== null) liveRobux = v;
    }
    const robuxValue = saved !== null ? saved : (liveRobux !== null ? liveRobux : 0);
    const verifiedEnabled = store.get('verifiedEnabled');
    const greetingEnabled = store.get('greetingEnabled');
    const valuesEnabled = store.get('valuesEnabled');
    const hideSerials = store.get('hideSerials');
    const debugValues = store.get('debugValues');
    const shareUsage = store.get('shareUsage');
    overlay.innerHTML = `
        <div class="blox-suite-modal" role="dialog" aria-label="Suite Settings">
            <div class="blox-suite-header">
                <div class="blox-suite-header-title"><span class="dot"></span>Suite Settings <span class="blox-suite-ver">v${BLOX_SUITE_VERSION}</span></div>
                <button class="blox-suite-close" id="blox-suite-close" aria-label="Close">&#10005;</button>
            </div>
            <div class="blox-suite-tabs">
                <button class="blox-suite-tab active" data-page="general" type="button">General</button>
                <button class="blox-suite-tab" data-page="friends" type="button">Friends</button>
            </div>
            <div class="blox-suite-body">
                <div class="blox-suite-page active" data-page="general">
                    <div class="blox-suite-master-row">
                        <div>
                            <div class="label">Enable Blox Suite</div>
                            <div class="sublabel">Turn all features on or off</div>
                        </div>
                        <label class="blox-suite-switch">
                            <input type="checkbox" id="blox-suite-master-toggle" ${enabled ? 'checked' : ''}>
                            <span class="slider"></span>
                        </label>
                    </div>

                    <div class="blox-suite-section">
                        <div class="blox-suite-row">
                            <div>
                                <div class="label">Set Robux Value</div>
                                <div class="sublabel">Override the displayed balance</div>
                            </div>
                            <label class="blox-suite-switch">
                                <input type="checkbox" id="blox-suite-robux-toggle" ${robuxEnabled ? 'checked' : ''}>
                                <span class="slider"></span>
                            </label>
                        </div>
                        <div class="blox-suite-input-row">
                            <div class="blox-suite-input-wrap">
                                ${svgRobuxIcon()}
                                <input type="text" inputmode="numeric" class="blox-suite-input has-icon" id="blox-suite-robux-input" value="${formatRobux(robuxValue)}" placeholder="0">
                            </div>
                        </div>
                        <div class="blox-suite-preview">Nav: <b>${abbreviateRobux(robuxValue)}</b> &nbsp;&middot;&nbsp; Balance: <b>${formatRobux(robuxValue)}</b></div>
                    </div>

                    <div class="blox-suite-section">
                        <div class="blox-suite-row">
                            <div>
                                <div class="label">Verified Badge</div>
                                <div class="sublabel">Shows a verified check on your name</div>
                            </div>
                            <label class="blox-suite-switch">
                                <input type="checkbox" id="blox-suite-verified-toggle" ${verifiedEnabled ? 'checked' : ''}>
                                <span class="slider"></span>
                            </label>
                        </div>
                    </div>

                    <div class="blox-suite-section">
                        <div class="blox-suite-row">
                            <div>
                                <div class="label">Home Greeting</div>
                                <div class="sublabel">Replaces "Home" with your name</div>
                            </div>
                            <label class="blox-suite-switch">
                                <input type="checkbox" id="blox-suite-greeting-toggle" ${greetingEnabled ? 'checked' : ''}>
                                <span class="slider"></span>
                            </label>
                        </div>
                    </div>
                    <div class="blox-suite-section">
                        <div class="blox-suite-row">
                            <div>
                                <div class="label">Limited Values</div>
                                <div class="sublabel">Shows RAP and value from Rolimons</div>
                            </div>
                            <label class="blox-suite-switch">
                                <input type="checkbox" id="blox-suite-values-toggle" ${valuesEnabled ? 'checked' : ''}>
                                <span class="slider"></span>
                            </label>
                        </div>
                        <div class="blox-suite-hint" id="blox-suite-roli-status">Checking Rolimons&hellip;</div>
                        <div style="display:flex;gap:6px;margin-top:8px;">
                          <button class="blox-suite-add-btn" id="blox-suite-roli-retry" type="button" style="display:none;padding:6px 14px;">Retry</button>
                          <button class="blox-suite-add-btn" id="blox-suite-roli-diag" type="button" style="display:none;padding:6px 14px;">Diagnose</button>
                        </div>
                        <pre class="blox-suite-diag" id="blox-suite-diag-out" style="display:none;"></pre>
                        <div id="blox-suite-import-wrap" style="display:none;margin-top:10px;">
                          <div class="blox-suite-hint">Blocked? Open <b>api.rolimons.com/items/v1/itemdetails</b> in a normal tab, copy everything, and paste it here.</div>
                          <textarea class="blox-suite-input" id="blox-suite-import" rows="3" placeholder='{"success":true,"items":{...}}' style="resize:vertical;font-family:ui-monospace,monospace;font-size:11px;"></textarea>
                          <button class="blox-suite-add-btn" id="blox-suite-import-btn" type="button" style="margin-top:6px;padding:6px 14px;">Import</button>
                        </div>
                    </div>
                    <div class="blox-suite-section">
                        <div class="blox-suite-row">
                            <div>
                                <div class="label">Share Usage</div>
                                <div class="sublabel">Sends your username to the Blox Suite owner so they can see who&rsquo;s using it</div>
                            </div>
                            <label class="blox-suite-switch">
                                <input type="checkbox" id="blox-suite-usage-toggle" ${shareUsage ? 'checked' : ''}>
                                <span class="slider"></span>
                            </label>
                        </div>
                        <div class="blox-suite-hint" id="blox-suite-beat-status"></div>
                        <button class="blox-suite-add-btn" id="blox-suite-beat-test" type="button" style="margin-top:8px;padding:6px 14px;">Send test beat</button>
                    </div>
                    <div class="blox-suite-section">
                        <div class="blox-suite-row">
                            <div>
                                <div class="label">Debug Values</div>
                                <div class="sublabel">Logs why each item shows or hides a value</div>
                            </div>
                            <label class="blox-suite-switch">
                                <input type="checkbox" id="blox-suite-debug-toggle" ${debugValues ? 'checked' : ''}>
                                <span class="slider"></span>
                            </label>
                        </div>
                    </div>
                    <div class="blox-suite-section">
                        <div class="blox-suite-row">
                            <div>
                                <div class="label">Hide Limited Serials</div>
                                <div class="sublabel">Hides #UIDs so items can&rsquo;t be traced</div>
                            </div>
                            <label class="blox-suite-switch">
                                <input type="checkbox" id="blox-suite-serials-toggle" ${hideSerials ? 'checked' : ''}>
                                <span class="slider"></span>
                            </label>
                        </div>
                    </div>
                </div>

                <div class="blox-suite-page" data-page="friends">
                    <div class="blox-suite-add-row">
                        <input type="text" inputmode="numeric" class="blox-suite-input" id="blox-suite-friend-input" placeholder="User ID, e.g. 261">
                        <button class="blox-suite-add-btn" id="blox-suite-friend-add" type="button">Add</button>
                    </div>
                    <div class="blox-suite-hint" id="blox-suite-friend-hint">Spoofs friends to your friends list.</div>
                    <ul class="blox-suite-friend-list" id="blox-suite-friend-list"></ul>
                </div>

            </div>
            <div class="blox-suite-footer">
                <span class="blox-suite-saved-toast" id="blox-suite-toast">Saved</span>
                <button class="blox-suite-save-btn" id="blox-suite-save">Save</button>
            </div>
        </div>
        `;
    return overlay;
  }

  function wireBeatTest(root) {
    const btn = root.querySelector('#blox-suite-beat-test');
    const out = root.querySelector('#blox-suite-beat-status');
    if (!btn || btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';

    if (!STATS_URL) {
      out.classList.add('error');
      out.textContent = 'STATS_URL is empty in the script, so nothing is ever sent.';
      btn.style.display = 'none';
      return;
    }

    btn.addEventListener('click', () => {
      out.classList.remove('error');
      out.textContent = 'Sending\u2026';
      const uid = ownUserId || detectOwnUserId();
      if (!uid) {
        out.classList.add('error');
        out.textContent = 'Could not detect your Roblox user id on this page.';
        return;
      }
      const gm = typeof GM_xmlhttpRequest === 'function' ? GM_xmlhttpRequest
        : (typeof GM !== 'undefined' && GM && typeof GM.xmlHttpRequest === 'function' ? GM.xmlHttpRequest : null);
      if (!gm) {
        out.classList.add('error');
        out.textContent = 'GM_xmlhttpRequest unavailable - your userscript manager did not grant it.';
        return;
      }
      gm({
        method: 'POST',
        url: STATS_URL.replace(/\/$/, '') + '/beat',
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify({ id: uid, name: getOwnDisplayName() || 'unknown', version: BLOX_SUITE_VERSION }),
        timeout: 10000,
        onload: (r) => {
          if (r.status === 200) {
            out.classList.remove('error');
            out.textContent = 'Sent as ' + (getOwnDisplayName() || uid) + ' - HTTP 200. ' + (r.responseText || '');
          } else {
            out.classList.add('error');
            out.textContent = 'Worker replied HTTP ' + r.status + '. ' + (r.responseText || '');
          }
        },
        onerror: () => {
          out.classList.add('error');
          out.textContent = 'Refused before sending - the worker domain is not approved in your userscript manager. Reinstall the script and accept the prompt.';
        },
        ontimeout: () => {
          out.classList.add('error');
          out.textContent = 'Timed out reaching the worker.';
        },
      });
    });
  }

  function updateRoliStatus(root) {
    const el = root.querySelector('#blox-suite-roli-status');
    const retry = root.querySelector('#blox-suite-roli-retry');
    if (!el) return;
    el.textContent = 'Checking Rolimons\u2026';
    el.classList.remove('error');
    if (retry) retry.style.display = 'none';
    getRolimons().then((items) => {
      if (items) {
        const n = Object.keys(items).length;
        el.classList.remove('error');
        el.textContent = 'Rolimons connected \u00b7 ' + n.toLocaleString('en-US') + ' items' +
          (rolimonsStatus === 'cached' ? ' (cached)' : '');
        if (retry) retry.style.display = 'none';
      } else {
        el.classList.add('error');
        el.textContent = 'Rolimons unavailable \u2014 ' + (roliError || 'unknown error');
        if (retry) retry.style.display = 'inline-block';
        const diag = root.querySelector('#blox-suite-roli-diag');
        if (diag) diag.style.display = 'inline-block';
        const imp = root.querySelector('#blox-suite-import-wrap');
        if (imp) imp.style.display = 'block';
      }
    });
    const diag = root.querySelector('#blox-suite-roli-diag');
    const out = root.querySelector('#blox-suite-diag-out');
    if (diag && diag.dataset.bound !== '1') {
      diag.dataset.bound = '1';
      diag.addEventListener('click', () => {
        out.style.display = 'block';
        out.textContent = 'Testing\u2026';
        runConnectivityTest().then((text) => { out.textContent = text; });
      });
    }
    const impBtn = root.querySelector('#blox-suite-import-btn');
    if (impBtn && impBtn.dataset.bound !== '1') {
      impBtn.dataset.bound = '1';
      impBtn.addEventListener('click', () => {
        const ta = root.querySelector('#blox-suite-import');
        const el2 = root.querySelector('#blox-suite-roli-status');
        let parsed = null;
        try { parsed = JSON.parse(ta.value.trim()); } catch (e) {}
        if (!parsed || !parsed.items) {
          el2.classList.add('error');
          el2.textContent = 'That did not look like Rolimons item data.';
          return;
        }
        writeRoliCache(parsed.items);
        rolimonsPromise = null;
        roliError = null;
        rolimonsStatus = 'idle';
        ta.value = '';
        updateRoliStatus(root);
        runAllPatches();
      });
    }
    if (retry && retry.dataset.bound !== '1') {
      retry.dataset.bound = '1';
      retry.addEventListener('click', () => {
        rolimonsPromise = null;
        roliError = null;
        rolimonsStatus = 'idle';
        try { GM_setValue(ROLI_CACHE_KEY, null); } catch (e) {}
        try { localStorage.removeItem(ROLI_CACHE_KEY); } catch (e) {}
        updateRoliStatus(root);
        runAllPatches();
      });
    }
  }

  function renderFriendList(root) {
    const list = root.querySelector('#blox-suite-friend-list');
    if (!list) return;
    const ids = store.get('fakeFriends') || [];
    list.innerHTML = '';
    if (!ids.length) {
      const empty = document.createElement('li');
      empty.className = 'blox-suite-empty';
      empty.textContent = 'No players added yet. Paste a user ID above to get started.';
      list.appendChild(empty);
      return;
    }
    ids.forEach((id) => {
      const data = friendCache[id];
      const li = document.createElement('li');
      li.className = 'blox-suite-friend';
      const img = document.createElement('img');
      if (data && data.avatar) img.src = data.avatar;
      img.alt = '';
      li.appendChild(img);
      const meta = document.createElement('div');
      meta.className = 'blox-suite-friend-meta';
      const name = document.createElement('div');
      name.className = 'blox-suite-friend-name';
      const dot = document.createElement('span');
      const pType = data ? data.presenceType : 0;
      dot.className = 'blox-suite-presence ' + (pType === 2 ? 'game' : pType === 3 ? 'studio' : pType === 1 ? 'online' : 'offline');
      name.appendChild(dot);
      name.appendChild(document.createTextNode(data ? data.displayName : 'Loading\u2026'));
      meta.appendChild(name);
      const sub = document.createElement('div');
      sub.className = 'blox-suite-friend-sub';
      if (data) {
        sub.textContent = data.presenceType === 2 && data.lastLocation
          ? data.lastLocation
          : '@' + data.name + ' \u00b7 ' + id;
      } else {
        sub.textContent = 'ID ' + id;
      }
      meta.appendChild(sub);
      li.appendChild(meta);
      const rm = document.createElement('button');
      rm.className = 'blox-suite-remove';
      rm.type = 'button';
      rm.title = 'Remove';
      rm.textContent = '\u2715';
      rm.addEventListener('click', () => {
        const next = (store.get('fakeFriends') || []).filter((x) => x !== id);
        store.set('fakeFriends', next);
        revertFakeFriends();
        revertFriendProfile();
        runAllPatches();
        renderFriendList(root);
      });
      li.appendChild(rm);
      list.appendChild(li);
      if (!data) fetchFriendData(id).then((d) => { if (d) renderFriendList(root); });
    });
  }

  function wireFriendsPage(root) {
    const input = root.querySelector('#blox-suite-friend-input');
    const addBtn = root.querySelector('#blox-suite-friend-add');
    const hint = root.querySelector('#blox-suite-friend-hint');
    if (!input || !addBtn) return;
    const setHint = (msg, isError) => {
      hint.textContent = msg;
      hint.classList.toggle('error', !!isError);
    };
    const add = () => {
      const id = input.value.replace(/[^\d]/g, '');
      if (!id) {
        setHint('Enter a numeric user ID.', true);
        return;
      }
      const ids = store.get('fakeFriends') || [];
      if (ids.indexOf(id) !== -1) {
        setHint('That player is already on the list.', true);
        return;
      }
      addBtn.disabled = true;
      setHint('Looking up ' + id + '\u2026', false);
      fetchFriendData(id).then((data) => {
        addBtn.disabled = false;
        if (!data) {
          setHint('No player found with ID ' + id + '.', true);
          return;
        }
        store.set('fakeFriends', (store.get('fakeFriends') || []).concat([id]));
        input.value = '';
        setHint('Added ' + data.displayName + '.', false);
        renderFriendList(root);
        runAllPatches();
      });
    };
    addBtn.addEventListener('click', add);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        add();
      }
    });
  }

  function wireTabs(root) {
    root.querySelectorAll('.blox-suite-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        const page = tab.dataset.page;
        root.querySelectorAll('.blox-suite-tab').forEach((t) => t.classList.toggle('active', t === tab));
        root.querySelectorAll('.blox-suite-page').forEach((p) => p.classList.toggle('active', p.dataset.page === page));
      });
    });
  }

  function setSectionEnabledState(root) {
    const master = root.querySelector('#blox-suite-master-toggle').checked;
    root.querySelectorAll('.blox-suite-section').forEach((section) => {
      section.classList.toggle('disabled', !master);
    });
    const friendsPage = root.querySelector('.blox-suite-page[data-page="friends"]');
    if (friendsPage) friendsPage.classList.toggle('disabled', !master);
  }

  function sanitizeNumberInput(inputEl) {
    const raw = inputEl.value.replace(/[^\d]/g, '');
    const num = raw === '' ? 0 : parseInt(raw, 10);
    inputEl.value = formatRobux(num);
    return num;
  }

  function openSettingsModal() {
    if (modalRoot) return;
    modalRoot = buildModal();
    document.body.appendChild(modalRoot);
    const close = () => {
      if (!modalRoot) return;
      modalRoot.remove();
      modalRoot = null;
    };
    modalRoot.querySelector('#blox-suite-close').addEventListener('click', close);
    modalRoot.addEventListener('click', (e) => {
      if (e.target === modalRoot) close();
    });
    document.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape') {
        close();
        document.removeEventListener('keydown', escHandler);
      }
    });
    const robuxInput = modalRoot.querySelector('#blox-suite-robux-input');
    const previewParts = modalRoot.querySelectorAll('.blox-suite-preview b');
    robuxInput.addEventListener('input', () => {
      const num = sanitizeNumberInput(robuxInput);
      if (previewParts[0]) previewParts[0].textContent = abbreviateRobux(num);
      if (previewParts[1]) previewParts[1].textContent = formatRobux(num);
    });
    modalRoot.querySelector('#blox-suite-master-toggle').addEventListener('change', () => {
      setSectionEnabledState(modalRoot);
    });
    setSectionEnabledState(modalRoot);
    wireTabs(modalRoot);
    updateRoliStatus(modalRoot);
    wireBeatTest(modalRoot);
    wireFriendsPage(modalRoot);
    renderFriendList(modalRoot);
    modalRoot.querySelector('#blox-suite-save').addEventListener('click', () => {
      const masterEnabled = modalRoot.querySelector('#blox-suite-master-toggle').checked;
      const robuxEnabled = modalRoot.querySelector('#blox-suite-robux-toggle').checked;
      const robuxValue = sanitizeNumberInput(robuxInput);
      const verifiedEnabled = modalRoot.querySelector('#blox-suite-verified-toggle').checked;
      const greetingEnabled = modalRoot.querySelector('#blox-suite-greeting-toggle').checked;
      const valuesEnabled = modalRoot.querySelector('#blox-suite-values-toggle').checked;
      const hideSerials = modalRoot.querySelector('#blox-suite-serials-toggle').checked;
      const debugValues = modalRoot.querySelector('#blox-suite-debug-toggle').checked;
      const shareUsage = modalRoot.querySelector('#blox-suite-usage-toggle').checked;
      const wasVerifiedOn = store.get('enabled') && store.get('verifiedEnabled');
      const wasRobuxOn = store.get('enabled') && store.get('robuxEnabled');
      const wasGreetingOn = store.get('enabled') && store.get('greetingEnabled');
      const wasFriendsOn = store.get('enabled');
      store.set('enabled', masterEnabled);
      store.set('robuxEnabled', robuxEnabled);
      store.set('robuxValue', robuxValue);
      store.set('verifiedEnabled', verifiedEnabled);
      store.set('greetingEnabled', greetingEnabled);
      store.set('valuesEnabled', valuesEnabled);
      store.set('hideSerials', hideSerials);
      store.set('debugValues', debugValues);
      store.set('shareUsage', shareUsage);
      if (!(masterEnabled && valuesEnabled)) revertValueCards();
      if (!(masterEnabled && hideSerials)) revertHideSerials();
      const willVerifiedBeOn = masterEnabled && verifiedEnabled;
      if (wasVerifiedOn && !willVerifiedBeOn) {
        revertVerifiedBadge();
      }
      const willRobuxBeOn = masterEnabled && robuxEnabled;
      if (wasRobuxOn && !willRobuxBeOn) {
        revertRobuxDisplay();
      }
      const willGreetingBeOn = masterEnabled && greetingEnabled;
      if (wasGreetingOn && !willGreetingBeOn) {
        revertHomeGreeting();
      }
      if (wasFriendsOn && !masterEnabled) {
        revertFakeFriends();
        revertFriendProfile();
      }
      runAllPatches();
      const toast = modalRoot.querySelector('#blox-suite-toast');
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 1400);
    });
  }

  const BEAT_KEY = 'bloxSuiteLastBeat';
  const BEAT_INTERVAL = 2 * 60 * 1000;

  function sendBeat(manual) {
    const say = (msg, extra) => {
      if (manual || store.get('debugValues')) console.log('[Blox Suite] beat: ' + msg, extra !== undefined ? extra : '');
    };

    if (!STATS_URL) return say('STATS_URL is empty - set it at the top of the script');
    if (!store.get('shareUsage')) return say('skipped, Share Usage is off in settings');

    const uid = ownUserId || detectOwnUserId();
    if (!uid) return say('skipped, could not detect your user id yet');

    if (!manual) {
      try {
        const last = parseInt(localStorage.getItem(BEAT_KEY) || '0', 10);
        if (Date.now() - last < BEAT_INTERVAL - 2000) {
          return say('skipped, another tab beat ' + Math.round((Date.now() - last) / 1000) + 's ago');
        }
        localStorage.setItem(BEAT_KEY, String(Date.now()));
      } catch (e) {}
    }

    const gm = typeof GM_xmlhttpRequest === 'function' ? GM_xmlhttpRequest
      : (typeof GM !== 'undefined' && GM && typeof GM.xmlHttpRequest === 'function' ? GM.xmlHttpRequest : null);
    if (!gm) return say('GM_xmlhttpRequest unavailable - userscript manager did not grant it');

    const url = STATS_URL.replace(/\/$/, '') + '/beat';
    say('sending to ' + url);

    try {
      gm({
        method: 'POST',
        url: url,
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify({
          id: uid,
          name: getOwnDisplayName() || 'unknown',
          version: BLOX_SUITE_VERSION,
        }),
        timeout: 10000,
        onload: (r) => say('server replied HTTP ' + r.status, r.responseText),
        onerror: (e) => say('REFUSED - the worker domain is blocked by your userscript manager', e),
        ontimeout: () => say('timed out'),
      });
    } catch (e) {
      say('threw', e);
    }
  }

  function startHeartbeat() {
    if (!STATS_URL) return;
    setTimeout(sendBeat, 4000);
    setInterval(sendBeat, BEAT_INTERVAL);
  }

  function boot() {
    loadSettings();
    injectStyles();
    applyThemeTokens(true);
    setInterval(() => applyThemeTokens(true), 4000);
    runAllPatches();
    tryInjectMenuItem();
    startObserver();
    startHeartbeat();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
