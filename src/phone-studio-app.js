import { GENERATION_TOOLS, sanitizeGenerationError } from './generation-service.js';
import { normalizeSocialState, renderToolState } from './studio-views.js';

const APP_ID = 'yssa-story-studio';
const DEFAULT_TOOL_ID = GENERATION_TOOLS[0].id;
const APP_ICON = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#7768e5"/><stop offset="1" stop-color="#4f9ee8"/></linearGradient></defs><rect width="128" height="128" rx="30" fill="url(#g)"/><path d="M34 31c14-5 25-1 30 8 7-10 18-12 30-7v57c-13-4-23 0-30 9-8-9-18-13-30-9V31Z" fill="none" stroke="#fff" stroke-width="7"/><path d="M64 40v58M87 20l3 8 8 3-8 3-3 8-3-8-8-3 8-3 3-8Z" fill="#fff"/></svg>`)} `;
const APP_DESCRIPTOR = Object.freeze({ id: APP_ID, name: '剧情工坊', icon: '✦', defaultIcon: APP_ICON.trim(), color: '#5b78df', badge: 0, data: {} });

const TOOL_NAV = Object.freeze({
  story: { label: '剧情', icon: 'fa-compass' },
  investigation: { label: '调查', icon: 'fa-user-secret' },
  achievements: { label: '成就', icon: 'fa-trophy' },
  social: { label: '笔记', icon: 'fa-note-sticky' },
});

function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function toolById(toolId) {
  return GENERATION_TOOLS.find((tool) => tool.id === toolId) || null;
}

export class StoryStudioPhoneApp {
  constructor(runtime) {
    this.runtime = runtime;
    this.active = false;
    this.currentToolId = DEFAULT_TOOL_ID;
    this.abortController = null;
    this.retryTimer = null;
    this.busy = false;
    this.registerAttempts = 0;
    this.pendingView = DEFAULT_TOOL_ID;
    this.promptToolId = DEFAULT_TOOL_ID;
    this.socialPostId = '';
    this.lastChatKey = '';
  }

  start() {
    if (this.active || typeof window === 'undefined') return;
    this.active = true;
    this.abortController = new AbortController();
    const signal = this.abortController.signal;
    window.addEventListener('phone:openApp', (event) => {
      if (event?.detail?.appId !== APP_ID) return;
      event.stopImmediatePropagation();
      queueMicrotask(() => {
        const view = this.pendingView;
        this.pendingView = DEFAULT_TOOL_ID;
        this.open(view);
      });
    }, { signal, capture: true });
    window.addEventListener('phone:panelVisibility', () => this.scheduleRegister(0, true), { signal });
    window.addEventListener('phone:goHome', () => this.scheduleRegister(0, true), { signal });
    window.addEventListener('yuzuki-content-addon:status', () => this.scheduleRegister(0), { signal });
    this.scheduleRegister(0);
  }

  stop() {
    if (!this.active) return;
    this.runtime.cancelGeneration();
    this.abortController?.abort();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.removeDescriptor();
    document.querySelector('.yssa-phone-app')?.remove();
    this.active = false;
    this.busy = false;
  }

  onRuntimeStatus(status = this.runtime.getStatus()) {
    const nextChatKey = String(status?.chatKey || '');
    const chatChanged = Boolean(this.lastChatKey && nextChatKey && this.lastChatKey !== nextChatKey);
    if (nextChatKey) this.lastChatKey = nextChatKey;
    this.scheduleRegister(0);
    this.updateConnectionBadge();
    if (chatChanged && !this.busy && document.querySelector('.phone-view-current .yssa-phone-app')) {
      this.socialPostId = '';
      this.renderTool(this.currentToolId || DEFAULT_TOOL_ID);
    }
  }

  scheduleRegister(delay = 500, reset = false) {
    if (!this.active || this.retryTimer) return;
    if (reset) this.registerAttempts = 0;
    if (this.registerAttempts >= 30) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.registerAttempts += 1;
      if (!this.registerDescriptor()) this.scheduleRegister(1200);
    }, delay);
  }

  registerDescriptor() {
    const home = window.VirtualPhone?.home;
    if (!home || !Array.isArray(home.apps) || !home.phoneShell?.setContent) return false;
    if (!home.apps.some((app) => app?.id === APP_ID)) home.apps.push({ ...APP_DESCRIPTOR });
    this.registerAttempts = 0;
    if (home.isHomeScreenVisible?.()) home.render({ forceDomRefresh: true });
    return true;
  }

  removeDescriptor() {
    const home = window.VirtualPhone?.home;
    if (!Array.isArray(home?.apps)) return;
    const index = home.apps.findIndex((app) => app?.id === APP_ID);
    if (index >= 0) home.apps.splice(index, 1);
    try { window.VirtualPhone?.storage?.saveApps?.(home.apps); } catch (_error) {}
    if (home.isHomeScreenVisible?.()) home.render({ forceDomRefresh: true });
  }

  open(view = DEFAULT_TOOL_ID) {
    if (!this.active) return;
    try {
      this.registerDescriptor();
      if (!this.getShell()?.setContent) return;
      if (view === 'prompt-settings') this.renderPromptSettings(this.promptToolId);
      else this.renderTool(toolById(view)?.id || this.currentToolId || DEFAULT_TOOL_ID);
    } catch (error) {
      console.error('[柚月剧情工坊] 打开页面失败', error);
    }
  }

  openFromSettings(view = DEFAULT_TOOL_ID) {
    if (!this.registerDescriptor() || !this.getShell()?.setContent) {
      window.toastr?.info?.('请先打开一次柚月手机，再点击“剧情工坊”图标。', '柚月剧情工坊');
      return false;
    }
    const panel = document.getElementById('phone-panel');
    const panelIsOpen = panel?.classList.contains('phone-panel-open') && !panel?.classList.contains('phone-panel-hidden');
    if (!panelIsOpen) document.getElementById('phoneDrawerIcon')?.click?.();
    this.pendingView = view;
    setTimeout(() => window.dispatchEvent(new CustomEvent('phone:openApp', { detail: { appId: APP_ID } })), panelIsOpen ? 0 : 120);
    return true;
  }

  getShell() {
    return window.VirtualPhone?.home?.phoneShell || null;
  }

  setContent(html, viewId) {
    const shell = this.getShell();
    if (!shell?.setContent) throw new Error('柚月手机页面容器尚未就绪。');
    shell.setContent(html, viewId);
    return shell.screen?.querySelector('.phone-view-current .yssa-phone-app')
      || shell.screen?.querySelector('.yssa-phone-app')
      || document.querySelector('.yssa-phone-app');
  }

  header(title, { promptSettings = false } = {}) {
    return `<header class="yssa-native-header">
      <div class="yssa-native-header-left"><button type="button" class="yssa-native-header-button" data-yssa-action="${promptSettings ? 'back-tool' : 'phone-home'}" aria-label="${promptSettings ? '返回剧情工坊' : '返回柚月桌面'}"><i class="fa-solid fa-chevron-left" aria-hidden="true"></i></button></div>
      <div class="yssa-native-header-title"><strong>${escapeHtml(title)}</strong><span class="yssa-connection-dot" data-yssa-connection aria-label="连接状态"></span></div>
      <div class="yssa-native-header-right">${promptSettings ? '' : '<button type="button" class="yssa-native-header-button" data-yssa-action="refresh-memory" aria-label="刷新记忆"><i class="fa-solid fa-rotate" aria-hidden="true"></i></button><button type="button" class="yssa-native-header-button" data-yssa-action="settings" aria-label="提示词设置"><i class="fa-solid fa-gear" aria-hidden="true"></i></button>'}</div>
    </header>`;
  }

  toolTabbar(activeToolId) {
    return `<nav class="yssa-native-tabbar" aria-label="剧情工坊主要功能">${GENERATION_TOOLS.map((tool) => {
      const active = tool.id === activeToolId;
      const nav = TOOL_NAV[tool.key];
      return `<button type="button" class="yssa-native-tab${active ? ' is-active' : ''}" data-yssa-tool="${tool.id}" ${active ? 'aria-current="page"' : ''}><i class="fa-solid ${nav.icon}" aria-hidden="true"></i><span>${nav.label}</span></button>`;
    }).join('')}</nav>`;
  }

  renderTool(toolId) {
    const tool = toolById(toolId) || toolById(DEFAULT_TOOL_ID);
    this.currentToolId = tool.id;
    if (tool.key !== 'social') this.socialPostId = '';
    const item = this.runtime.getGenerationItem(tool.id);
    const state = item?.state || item?.initialState || {};
    const actionLabel = tool.key === 'social' ? '生成信息流' : tool.key === 'investigation' ? '开始调查' : tool.key === 'achievements' ? '整理成就' : '更新状态';
    const investigationControls = tool.needsTarget ? `<section class="yssa-investigate-controls"><label><span>调查对象</span><input data-yssa-target list="yssa-target-list" maxlength="80" placeholder="输入角色姓名" value="${escapeHtml(state.meta?.target || state.target || '')}"><datalist id="yssa-target-list"></datalist></label><label><span>本次额外要求</span><textarea data-yssa-extra maxlength="4000" rows="3" placeholder="例如：侧重某段经历，只对本次生效"></textarea></label><label class="yssa-switch-row"><input type="checkbox" data-yssa-continue><span><strong>接续当前档案</strong><small>以当前原生档案为基线更新</small></span></label></section>` : '';
    const root = this.setContent(`<main class="yssa-phone-app yssa-native-app yssa-tool-page yssa-tool-page--${tool.key}">
      ${this.header(tool.name)}
      <div class="yssa-tool-scroll"><section class="yssa-tool-canvas" data-yssa-result>${renderToolState(tool.key, state, this.socialPostId)}</section>${investigationControls}<section class="yssa-generation-status" data-yssa-generation-status data-mode="idle"><span></span><div><strong>准备就绪</strong><p>数据由本扩展按当前聊天保存，只在点击时调用 AI。</p></div></section></div>
      <div class="yssa-native-actionbar"><button data-yssa-action="edit-prompt" aria-label="编辑当前提示词"><i class="fa-solid fa-pen" aria-hidden="true"></i></button><button class="yssa-stop-button" data-yssa-action="stop" hidden>停止</button><button class="yssa-generate-button" data-yssa-action="generate" data-yssa-idle-label="${actionLabel}"><i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i><span>${actionLabel}</span></button></div>
      ${this.toolTabbar(tool.id)}
    </main>`, 'yssa-story-studio-main');
    if (!root) return;
    this.bindCommon(root);
    this.bindToolInteractions(root, tool, state);
    root.querySelectorAll('.yssa-native-tab[data-yssa-tool]').forEach((button) => button.addEventListener('click', () => this.renderTool(button.dataset.yssaTool)));
    root.querySelector('[data-yssa-action="generate"]')?.addEventListener('click', () => this.generate(tool.id));
    root.querySelector('[data-yssa-action="stop"]')?.addEventListener('click', () => this.runtime.cancelGeneration());
    this.populateTargets(root);
    this.updateConnectionBadge(root);
    this.setBusy(root, this.busy);
  }

  bindToolInteractions(root, tool, state) {
    root.querySelectorAll('[data-yssa-subnav] button').forEach((button) => button.addEventListener('click', () => {
      const tab = button.dataset.yssaTab;
      const nav = button.closest('[data-yssa-subnav]');
      nav?.querySelectorAll('button').forEach((node) => node.classList.toggle('is-active', node === button));
      root.querySelectorAll('[data-yssa-panel]').forEach((panel) => panel.classList.toggle('is-active', panel.dataset.yssaPanel === tab));
    }));
    root.querySelectorAll('[data-yssa-action="open-post"]').forEach((button) => button.addEventListener('click', () => {
      this.socialPostId = button.dataset.postId;
      this.renderTool(tool.id);
    }));
    root.querySelector('[data-yssa-action="social-feed"]')?.addEventListener('click', () => {
      this.socialPostId = '';
      this.renderTool(tool.id);
    });
    root.querySelectorAll('[data-yssa-social-toggle]').forEach((button) => button.addEventListener('click', () => {
      const social = normalizeSocialState(state);
      const post = social.posts.find((entry) => String(entry.id) === String(button.dataset.postId));
      if (!post) return;
      const field = button.dataset.yssaSocialToggle;
      const countField = field === 'liked' ? 'likes' : 'favorites';
      post[field] = !post[field];
      post[countField] = Math.max(0, Number(post[countField] || 0) + (post[field] ? 1 : -1));
      this.runtime.updateToolState(tool.id, social);
      this.renderTool(tool.id);
    }));
  }

  renderPromptSettings(toolId = this.currentToolId || this.promptToolId) {
    const selected = toolById(toolId) || toolById(DEFAULT_TOOL_ID);
    this.promptToolId = selected.id;
    const tabs = GENERATION_TOOLS.map((tool) => `<button class="${tool.id === selected.id ? 'is-active' : ''}" data-yssa-prompt-tool="${tool.id}"><span>${tool.icon}</span><strong>${tool.name}</strong></button>`).join('');
    const root = this.setContent(`<main class="yssa-phone-app yssa-native-app yssa-prompt-settings">${this.header('提示词设置', { promptSettings: true })}
      <div class="yssa-tool-scroll"><section class="yssa-prompt-notice"><strong>每个栏目单独设置</strong><p>只影响剧情工坊的手动生成，不改柚月手机和记忆插件。</p></section><nav class="yssa-prompt-tabs">${tabs}</nav><section class="yssa-prompt-editor"><div><small>${selected.eyebrow}</small><h2>${selected.name}</h2><span data-yssa-prompt-mode></span></div><textarea data-yssa-prompt-text maxlength="32000" spellcheck="false"></textarea><p><span data-yssa-prompt-count>0</span> / 32000 字符</p><footer><button data-yssa-action="reset-prompt">恢复默认</button><button class="is-primary" data-yssa-action="save-prompt">保存</button></footer></section><button class="yssa-reset-all" data-yssa-action="reset-all-prompts">恢复全部默认提示词</button><p data-yssa-prompt-feedback></p></div>
    </main>`, 'yssa-story-studio-prompt-settings');
    if (!root) return;
    this.bindCommon(root);
    this.updateConnectionBadge(root);
    const textarea = root.querySelector('[data-yssa-prompt-text]');
    const count = root.querySelector('[data-yssa-prompt-count]');
    const mode = root.querySelector('[data-yssa-prompt-mode]');
    const feedback = root.querySelector('[data-yssa-prompt-feedback]');
    const load = () => {
      const value = this.runtime.getPrompt(selected.id);
      textarea.value = value;
      textarea.dataset.savedValue = value;
      count.textContent = value.length;
      mode.textContent = this.runtime.isPromptCustomized(selected.id) ? '已自定义' : '使用默认';
    };
    load();
    textarea.addEventListener('input', () => { count.textContent = textarea.value.length; feedback.textContent = textarea.value === textarea.dataset.savedValue ? '' : '有尚未保存的修改'; });
    root.querySelectorAll('[data-yssa-prompt-tool]').forEach((button) => button.addEventListener('click', () => {
      if (textarea.value !== textarea.dataset.savedValue && !window.confirm('当前修改尚未保存，确定切换吗？')) return;
      this.renderPromptSettings(button.dataset.yssaPromptTool);
    }));
    root.querySelector('[data-yssa-action="save-prompt"]')?.addEventListener('click', () => {
      try {
        const saved = this.runtime.savePrompt(selected.id, textarea.value);
        textarea.dataset.savedValue = saved;
        mode.textContent = '已自定义';
        feedback.textContent = '已保存，下一次生成立即生效。';
      } catch (error) { feedback.textContent = error.message; }
    });
    root.querySelector('[data-yssa-action="reset-prompt"]')?.addEventListener('click', () => {
      if (!window.confirm(`恢复“${selected.name}”的默认提示词？`)) return;
      const value = this.runtime.resetPrompt(selected.id);
      textarea.value = value;
      textarea.dataset.savedValue = value;
      count.textContent = value.length;
      mode.textContent = '使用默认';
      feedback.textContent = '已恢复默认。';
    });
    root.querySelector('[data-yssa-action="reset-all-prompts"]')?.addEventListener('click', () => {
      if (!window.confirm('恢复全部默认提示词？')) return;
      this.runtime.resetAllPrompts();
      load();
      feedback.textContent = '全部提示词已恢复默认。';
    });
  }

  bindCommon(root) {
    root.querySelector('[data-yssa-action="phone-home"]')?.addEventListener('click', () => window.dispatchEvent(new CustomEvent('phone:goHome')));
    root.querySelector('[data-yssa-action="back-tool"]')?.addEventListener('click', () => this.renderTool(this.currentToolId || DEFAULT_TOOL_ID));
    root.querySelectorAll('[data-yssa-action="settings"]').forEach((button) => button.addEventListener('click', () => this.renderPromptSettings(this.currentToolId)));
    root.querySelector('[data-yssa-action="edit-prompt"]')?.addEventListener('click', () => this.renderPromptSettings(this.currentToolId));
    root.querySelectorAll('[data-yssa-action="refresh-memory"]').forEach((button) => button.addEventListener('click', async () => {
      button.disabled = true;
      try { await this.runtime.refreshMemory('phone-app'); this.updateConnectionBadge(root); } finally { button.disabled = false; }
    }));
  }

  populateTargets(root) {
    const list = root.querySelector('#yssa-target-list');
    if (!list) return;
    this.runtime.getSuggestedTargets().forEach((name) => {
      const option = document.createElement('option');
      option.value = name;
      list.appendChild(option);
    });
  }

  updateConnectionBadge(root = document.querySelector('.yssa-phone-app')) {
    const node = root?.querySelector('[data-yssa-connection]');
    if (!node) return;
    const status = this.runtime.getStatus();
    node.classList.toggle('is-connected', Boolean(status.phoneReady && status.storageReady));
    node.classList.toggle('has-memory', Boolean(status.memoryReady));
    node.title = status.memoryReady ? '原生状态与柚月记忆已连接' : '原生状态已连接，等待柚月记忆';
  }

  setStatus(root, mode, title, detail) {
    const box = root?.querySelector('[data-yssa-generation-status]');
    if (!box) return;
    box.dataset.mode = mode;
    if (box.querySelector('strong')) box.querySelector('strong').textContent = title;
    if (box.querySelector('p')) box.querySelector('p').textContent = detail;
  }

  setBusy(root, busy) {
    this.busy = busy;
    root?.setAttribute('aria-busy', busy ? 'true' : 'false');
    const generate = root?.querySelector('[data-yssa-action="generate"]');
    const stop = root?.querySelector('[data-yssa-action="stop"]');
    if (generate) {
      generate.disabled = busy;
      generate.innerHTML = busy
        ? '<span class="yssa-spinner"></span><span>正在生成…</span>'
        : `<i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i><span>${escapeHtml(generate.dataset.yssaIdleLabel || '生成并保存')}</span>`;
    }
    if (stop) stop.hidden = !busy;
    root?.querySelectorAll('input, textarea').forEach((field) => { field.disabled = busy; });
  }

  async generate(toolId) {
    const root = document.querySelector('.phone-view-current .yssa-phone-app') || document.querySelector('.yssa-phone-app');
    if (!root || this.busy) return;
    const target = root.querySelector('[data-yssa-target]')?.value || '';
    const extraInstructions = root.querySelector('[data-yssa-extra]')?.value || '';
    const continueFromCurrent = Boolean(root.querySelector('[data-yssa-continue]')?.checked);
    this.setBusy(root, true);
    this.setStatus(root, 'loading', 'AI 正在生成内容', '当前聊天中已保存的旧内容会保留到本次成功。');
    try {
      await this.runtime.generateTool(toolId, { target, extraInstructions, continueFromCurrent });
      if (this.currentToolId !== toolId) return;
      this.socialPostId = '';
      this.renderTool(toolId);
      this.setStatus(document.querySelector('.phone-view-current .yssa-phone-app'), 'success', '生成并保存完成', '内容已保存到本扩展的当前聊天状态。');
    } catch (error) {
      if (this.currentToolId !== toolId) return;
      const aborted = error?.name === 'AbortError';
      this.setStatus(document.querySelector('.phone-view-current .yssa-phone-app'), aborted ? 'idle' : 'error', aborted ? '已停止生成' : '生成失败，可以重试', aborted ? '旧内容没有被改动。' : sanitizeGenerationError(error));
    } finally {
      if (this.currentToolId === toolId) this.setBusy(document.querySelector('.phone-view-current .yssa-phone-app'), false);
      else this.busy = false;
    }
  }
}

export function openStoryStudioApp() {
  window.dispatchEvent(new CustomEvent('phone:openApp', { detail: { appId: APP_ID } }));
}
