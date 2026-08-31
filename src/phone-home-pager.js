const EXTENSION_PAGE_SIZE = 12;

function iconSvg({ from, to, glyph }) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="128" height="128" rx="30" fill="url(#g)"/><text x="64" y="79" text-anchor="middle" font-family="Arial, sans-serif" font-size="54" font-weight="700" fill="white">${glyph}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export const YUZUKI_EXTENSION_APPS = Object.freeze([
  Object.freeze({ id: 'yssa-story', toolId: 'yssa_current_story_state', name: '剧情状态', icon: '剧', color: '#6578dc', defaultIcon: iconSvg({ from: '#7768e5', to: '#4f9ee8', glyph: '剧' }) }),
  Object.freeze({ id: 'yssa-investigation', toolId: 'yssa_investigation_report', name: '大调查', icon: '查', color: '#9c4c51', defaultIcon: iconSvg({ from: '#b4666b', to: '#6d343d', glyph: '查' }) }),
  Object.freeze({ id: 'yssa-achievements', toolId: 'yssa_achievement_book', name: '成就册', icon: '成', color: '#a57b32', defaultIcon: iconSvg({ from: '#d7ad58', to: '#7a5922', glyph: '成' }) }),
  Object.freeze({ id: 'yssa-social', toolId: 'yssa_social_notes', name: '小红书', icon: '记', color: '#ff2442', defaultIcon: iconSvg({ from: '#ff5a70', to: '#e81738', glyph: '记' }) }),
]);

export function paginateExtensionApps(apps, pageSize = EXTENSION_PAGE_SIZE) {
  const safeApps = Array.isArray(apps) ? apps.filter(Boolean) : [];
  const safeSize = Number.isInteger(pageSize) && pageSize > 0 ? pageSize : EXTENSION_PAGE_SIZE;
  const pages = [];
  for (let index = 0; index < safeApps.length; index += safeSize) pages.push(safeApps.slice(index, index + safeSize));
  return pages;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

export class PhoneHomePager {
  constructor({ apps = YUZUKI_EXTENSION_APPS } = {}) {
    this.apps = apps.map((app) => ({ ...app }));
    this.home = null;
    this.originalRender = null;
    this.wrappedRender = null;
    this.mountAbortController = null;
    this.currentPage = 0;
  }

  attach(home) {
    if (!home?.phoneShell?.screen || typeof home.render !== 'function') return false;
    if (this.home === home && home.render === this.wrappedRender) {
      this.mount();
      return true;
    }
    this.detach();
    this.home = home;
    this.originalRender = home.render;
    const pager = this;
    this.wrappedRender = function (...args) {
      const result = pager.originalRender.apply(this, args);
      queueMicrotask(() => pager.mount());
      return result;
    };
    home.render = this.wrappedRender;
    this.mount();
    return true;
  }

  detach() {
    this.mountAbortController?.abort();
    this.mountAbortController = null;
    globalThis.document?.querySelectorAll?.('[data-yssa-home-pager]').forEach((node) => node.remove());
    if (this.home && this.wrappedRender && this.home.render === this.wrappedRender && this.originalRender) {
      this.home.render = this.originalRender;
    }
    this.home = null;
    this.originalRender = null;
    this.wrappedRender = null;
    this.currentPage = 0;
  }

  createIcon(app) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'app-icon yzp-home-app-icon yzp-home-app-action yssa-home-app-icon';
    button.dataset.app = app.id;
    button.setAttribute('aria-label', `打开${app.name}`);
    button.style.setProperty('--app-color', app.color || '#6578dc');

    const icon = document.createElement('span');
    icon.className = 'app-icon-bg yzp-home-app-icon-bg custom-icon';
    const image = document.createElement('img');
    image.className = 'home-custom-icon-img yzp-home-custom-icon-img';
    image.src = app.defaultIcon;
    image.alt = '';
    image.draggable = false;
    icon.appendChild(image);

    const name = document.createElement('span');
    name.className = 'app-name yzp-home-app-name';
    name.textContent = app.name;
    button.append(icon, name);
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      window.dispatchEvent(new CustomEvent('phone:openApp', { detail: { appId: app.id } }));
    });
    return button;
  }

  mount() {
    if (typeof document === 'undefined' || !this.home) return false;
    const homeScreen = this.home.phoneShell?.screen?.querySelector('.home-screen');
    if (!homeScreen) return false;
    this.mountAbortController?.abort();
    this.mountAbortController = new AbortController();
    const { signal } = this.mountAbortController;
    homeScreen.querySelectorAll('[data-yssa-home-pager]').forEach((node) => node.remove());

    const extensionPages = paginateExtensionApps(this.apps);
    if (!extensionPages.length) return false;
    const totalPages = extensionPages.length + 1;
    this.currentPage = clamp(this.currentPage, 0, totalPages - 1);

    const track = document.createElement('div');
    track.className = 'yssa-home-page-track';
    track.dataset.yssaHomePager = 'track';
    const wallpaper = homeScreen.querySelector('.wallpaper');
    const wallpaperStyle = wallpaper?.getAttribute('style') || '';

    extensionPages.forEach((apps, extensionIndex) => {
      const pageIndex = extensionIndex + 1;
      const page = document.createElement('section');
      page.className = 'yssa-home-extension-page';
      page.dataset.yssaPage = String(pageIndex);
      page.setAttribute('aria-label', `扩展桌面第 ${pageIndex} 页`);
      page.style.left = `${pageIndex * 100}%`;
      const backdrop = document.createElement('div');
      backdrop.className = 'yssa-home-page-wallpaper';
      backdrop.setAttribute('style', wallpaperStyle);
      const grid = document.createElement('div');
      grid.className = 'app-grid yzp-home-app-grid yssa-home-extension-grid';
      apps.forEach((app) => grid.appendChild(this.createIcon(app)));
      page.append(backdrop, grid);
      track.appendChild(page);
    });

    const dots = document.createElement('nav');
    dots.className = 'yssa-home-page-dots';
    dots.dataset.yssaHomePager = 'dots';
    dots.setAttribute('aria-label', '手机桌面分页');
    for (let index = 0; index < totalPages; index += 1) {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.dataset.yssaPageTarget = String(index);
      dot.setAttribute('aria-label', index === 0 ? '官方桌面' : `扩展桌面第 ${index} 页`);
      dot.addEventListener('click', (event) => {
        event.stopPropagation();
        this.setPage(index);
      });
      dots.appendChild(dot);
    }

    const dock = homeScreen.querySelector('.dock');
    homeScreen.insertBefore(track, dock || null);
    homeScreen.insertBefore(dots, dock || null);
    this.bindGestures(homeScreen, signal);
    this.applyPage();
    return true;
  }

  bindGestures(homeScreen, signal) {
    let startX = null;
    let startY = null;
    let currentX = null;
    const isInteractive = (target) => Boolean(target?.closest?.('button, a, input, textarea, select, [role="button"], .app-icon, .dock-app'));
    const reset = () => { startX = null; startY = null; currentX = null; };

    homeScreen.addEventListener('touchstart', (event) => {
      if (isInteractive(event.target) || !event.touches?.length) return reset();
      startX = event.touches[0].clientX;
      startY = event.touches[0].clientY;
      currentX = startX;
      if (this.currentPage > 0) event.stopPropagation();
    }, { signal, passive: true });
    homeScreen.addEventListener('touchmove', (event) => {
      if (!Number.isFinite(startX) || !event.touches?.length) return;
      currentX = event.touches[0].clientX;
      const dx = currentX - startX;
      const dy = event.touches[0].clientY - startY;
      if (Math.abs(dx) <= Math.abs(dy) || Math.abs(dx) < 8) return;
      if (dx < 0 || this.currentPage > 0) {
        event.stopPropagation();
        if (event.cancelable) event.preventDefault();
      }
    }, { signal, passive: false });
    homeScreen.addEventListener('touchend', (event) => {
      if (!Number.isFinite(startX) || !Number.isFinite(currentX)) return reset();
      const dx = currentX - startX;
      if (Math.abs(dx) >= 45) {
        if (dx < 0) this.setPage(this.currentPage + 1);
        else if (this.currentPage > 0) this.setPage(this.currentPage - 1);
      }
      if (this.currentPage > 0) event.stopPropagation();
      reset();
    }, { signal, passive: true });
    homeScreen.addEventListener('touchcancel', reset, { signal, passive: true });

    homeScreen.addEventListener('pointerdown', (event) => {
      if (event.pointerType !== 'mouse' || event.button !== 0 || isInteractive(event.target)) return reset();
      startX = event.clientX;
      startY = event.clientY;
      currentX = startX;
    }, { signal });
    homeScreen.addEventListener('pointermove', (event) => {
      if (event.pointerType !== 'mouse' || !Number.isFinite(startX) || event.buttons === 0) return;
      currentX = event.clientX;
    }, { signal });
    homeScreen.addEventListener('pointerup', (event) => {
      if (event.pointerType !== 'mouse' || !Number.isFinite(startX) || !Number.isFinite(currentX)) return reset();
      const dx = currentX - startX;
      const dy = event.clientY - startY;
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) >= 45) this.setPage(this.currentPage + (dx < 0 ? 1 : -1));
      reset();
    }, { signal });
  }

  setPage(pageIndex) {
    const totalPages = paginateExtensionApps(this.apps).length + 1;
    this.currentPage = clamp(pageIndex, 0, totalPages - 1);
    this.applyPage();
  }

  applyPage() {
    const homeScreen = this.home?.phoneShell?.screen?.querySelector('.home-screen');
    const track = homeScreen?.querySelector('[data-yssa-home-pager="track"]');
    if (!track) return false;
    track.style.transform = `translate3d(${-this.currentPage * 100}%, 0, 0)`;
    homeScreen.classList.toggle('yssa-home-extension-page-active', this.currentPage > 0);
    homeScreen.querySelectorAll('[data-yssa-page-target]').forEach((dot) => {
      const active = Number(dot.dataset.yssaPageTarget) === this.currentPage;
      dot.classList.toggle('is-active', active);
      dot.setAttribute('aria-current', active ? 'page' : 'false');
    });
    return true;
  }

  showExtensionPage() {
    if (!this.home) return false;
    if (!this.home.isHomeScreenVisible?.()) this.home.render({ forceDomRefresh: true });
    else this.mount();
    queueMicrotask(() => this.setPage(1));
    return true;
  }
}
