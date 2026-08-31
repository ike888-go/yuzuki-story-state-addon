import { GENERATION_TOOLS, sanitizeGenerationError } from './generation-service.js';
import { normalizeSocialState, renderToolState } from './studio-views.js';

const APP_ID = 'yssa-story-studio';
const APP_ICON = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#b9899f"/><stop offset="1" stop-color="#718d7f"/></linearGradient></defs><rect width="128" height="128" rx="30" fill="#f7f3ec"/><path d="M35 32c15-5 25-1 29 8 8-10 19-12 31-7v55c-13-4-23 0-31 9-7-9-17-13-29-9V32Z" fill="none" stroke="url(#g)" stroke-width="7"/><path d="M64 41v56M86 21l3 8 8 3-8 3-3 8-3-8-8-3 8-3 3-8Z" fill="#9b6f85"/></svg>`)} `;
const APP_DESCRIPTOR = Object.freeze({ id: APP_ID, name: '剧情工坊', icon: '✦', defaultIcon: APP_ICON.trim(), color: '#9b6f85', badge: 0, data: {} });

function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function nowParts() {
  const now = new Date();
  return {
    time: now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }),
    date: now.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }),
  };
}

function toolById(toolId) {
  return GENERATION_TOOLS.find((tool) => tool.id === toolId) || null;
}

export class StoryStudioPhoneApp {
  constructor(runtime) {
    this.runtime = runtime;
    this.active = false;
    this.currentToolId = '';
    this.abortController = null;
    this.retryTimer = null;
    this.busy = false;
    this.registerAttempts = 0;
    this.pendingView = 'home';
    this.promptToolId = GENERATION_TOOLS[0].id;
    this.socialPostId = '';
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
        this.pendingView = 'home';
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

  onRuntimeStatus() {
    this.scheduleRegister(0);
    this.updateConnectionBadge();
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

  open(view = 'home') {
    if (!this.active) return;
    try {
      this.registerDescriptor();
      if (!this.getShell()?.setContent) return;
      if (view === 'prompt-settings') this.renderPromptSettings(this.promptToolId);
      else this.renderHome();
    } catch (error) {
      console.error('[柚月剧情工坊] 打开页面失败', error);
    }
  }

  openFromSettings(view = 'home') {
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
    return shell.screen?.querySelector('.yssa-phone-app') || document.querySelector('.yssa-phone-app');
  }

  header(title, eyebrow, { home = false, settings = false } = {}) {
    return `<header class="yssa-app-header">
      <button type="button" class="yssa-icon-button" data-yssa-action="${home ? 'phone-home' : 'back-list'}" aria-label="返回">‹</button>
      <div><small>${escapeHtml(eyebrow)}</small><h1>${escapeHtml(title)}</h1></div>
      ${settings ? '<button type="button" class="yssa-icon-button" data-yssa-action="settings" aria-label="提示词设置">⚙</button>' : '<span class="yssa-connection-dot" data-yssa-connection></span>'}
    </header>`;
  }

  renderHome() {
    this.currentToolId = '';
    this.socialPostId = '';
    const clock = nowParts();
    const status = this.runtime.getStatus();
    const story = this.runtime.getGenerationItem('yssa_current_story_state')?.state || {};
    const summary = story.scene?.summary || story.note || '把旧 App 里好用的内容，重新放回一部真正能玩的手机里。';
    const appTiles = GENERATION_TOOLS.map((tool) => `<button type="button" class="yssa-home-app yssa-home-app--${tool.key}" data-yssa-tool="${tool.id}"><span>${tool.icon}</span><strong>${tool.name}</strong><small>${tool.key === 'story' ? '状态 · 玩法 · 商店' : tool.eyebrow}</small></button>`).join('');
    const root = this.setContent(`<main class="yssa-phone-app yssa-studio-home">
      <div class="yssa-home-scroll">
        <div class="yssa-home-top"><span>${clock.time}</span><div><button data-yssa-action="refresh-memory" aria-label="刷新记忆">↻</button><button data-yssa-action="settings" aria-label="提示词设置">☷</button><span class="yssa-connection-dot" data-yssa-connection></span></div></div>
        <section class="yssa-home-clock"><small>${clock.date}</small><h1>${clock.time}</h1><h2>${status.memoryReady ? '记忆在，故事就不会散。' : '雨停了，风也温柔。'}</h2><p>${escapeHtml(summary)}</p></section>
        <button class="yssa-home-search" data-yssa-action="refresh-memory"><span>⌕</span><div><strong>搜索剧情与记忆</strong><small data-yssa-memory-text>读取当前会话记忆</small></div></button>
        <section class="yssa-home-app-grid">${appTiles}</section>
        <section class="yssa-home-continue"><small>CONTINUE STORY</small><h3>${escapeHtml(story.scene?.chapter || story.chapter || '还没有生成剧情状态')}</h3><p>${escapeHtml(story.protagonist?.objective || story.objective || '打开“剧情状态”，它会像原状态栏一样整理此刻。')}</p><button data-yssa-tool="yssa_current_story_state">继续查看 <span>→</span></button></section>
        <footer class="yssa-home-footer"><button data-yssa-action="open-mofo">魔坊数据</button><span>外置增量 App · 不修改柚月手机本体</span></footer>
      </div>
    </main>`, 'yssa-story-studio-home');
    if (!root) return;
    this.bindCommon(root);
    root.querySelectorAll('[data-yssa-tool]').forEach((button) => button.addEventListener('click', () => this.renderTool(button.dataset.yssaTool)));
    this.updateConnectionBadge(root);
    this.updateMemoryText(root);
  }

  renderTool(toolId) {
    const tool = toolById(toolId);
    if (!tool) return this.renderHome();
    this.currentToolId = toolId;
    const item = this.runtime.getGenerationItem(toolId);
    const state = item?.state || item?.initialState || {};
    const actionLabel = tool.key === 'social' ? '生成信息流' : tool.key === 'investigation' ? '开始调查' : tool.key === 'achievements' ? '整理成就' : '更新此刻';
    const investigationControls = tool.needsTarget ? `<section class="yssa-investigate-controls"><label><span>调查对象</span><input data-yssa-target list="yssa-target-list" maxlength="80" placeholder="输入角色姓名" value="${escapeHtml(state.meta?.target || state.target || '')}"><datalist id="yssa-target-list"></datalist></label><label><span>本次额外要求</span><textarea data-yssa-extra maxlength="4000" rows="3" placeholder="例如：侧重某段经历，只对本次生效"></textarea></label><label class="yssa-switch-row"><input type="checkbox" data-yssa-continue><span><strong>接续当前档案</strong><small>以现在的档案为基线更新</small></span></label></section>` : '';
    const root = this.setContent(`<main class="yssa-phone-app yssa-tool-page yssa-tool-page--${tool.key}">
      ${this.header(tool.name, tool.eyebrow)}
      <div class="yssa-tool-scroll"><section class="yssa-tool-canvas" data-yssa-result>${renderToolState(tool.key, state, this.socialPostId)}</section>${investigationControls}<section class="yssa-generation-status" data-yssa-generation-status data-mode="idle"><span></span><div><strong>准备就绪</strong><p>只在你点击时调用 AI，成功后保存到当前聊天。</p></div></section></div>
      <footer class="yssa-tool-dock"><button data-yssa-action="edit-prompt" aria-label="编辑提示词">✎</button><button class="yssa-stop-button" data-yssa-action="stop" hidden>停止</button><button class="yssa-generate-button" data-yssa-action="generate" data-yssa-idle-label="${actionLabel}"><span>✦</span>${actionLabel}</button></footer>
    </main>`, `yssa-story-studio-${tool.key}`);
    if (!root) return;
    this.bindCommon(root);
    this.bindToolInteractions(root, tool, state);
    root.querySelector('[data-yssa-action="generate"]')?.addEventListener('click', () => this.generate(toolId));
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
      this.runtime.updateToolState(tool.id, social, 'yuzuki-story-studio-interaction');
      this.renderTool(tool.id);
    }));
  }

  renderPromptSettings(toolId = this.promptToolId) {
    const selected = toolById(toolId) || GENERATION_TOOLS[0];
    this.promptToolId = selected.id;
    this.currentToolId = '';
    const tabs = GENERATION_TOOLS.map((tool) => `<button class="${tool.id === selected.id ? 'is-active' : ''}" data-yssa-prompt-tool="${tool.id}"><span>${tool.icon}</span><strong>${tool.name}</strong></button>`).join('');
    const root = this.setContent(`<main class="yssa-phone-app yssa-prompt-settings">${this.header('生成提示词', 'PROMPT SETTINGS')}
      <div class="yssa-tool-scroll"><section class="yssa-prompt-notice"><strong>每个 App 单独设置</strong><p>只影响剧情工坊的手动生成，不改柚月手机和记忆插件。</p></section><nav class="yssa-prompt-tabs">${tabs}</nav><section class="yssa-prompt-editor"><div><small>${selected.eyebrow}</small><h2>${selected.name}</h2><span data-yssa-prompt-mode></span></div><textarea data-yssa-prompt-text maxlength="32000" spellcheck="false"></textarea><p><span data-yssa-prompt-count>0</span> / 32000 字符</p><footer><button data-yssa-action="reset-prompt">恢复默认</button><button class="is-primary" data-yssa-action="save-prompt">保存</button></footer></section><button class="yssa-reset-all" data-yssa-action="reset-all-prompts">恢复全部默认提示词</button><p data-yssa-prompt-feedback></p></div>
    </main>`, 'yssa-story-studio-prompt-settings');
    if (!root) return;
    this.bindCommon(root);
    const textarea = root.querySelector('[data-yssa-prompt-text]');
    const count = root.querySelector('[data-yssa-prompt-count]');
    const mode = root.querySelector('[data-yssa-prompt-mode]');
    const feedback = root.querySelector('[data-yssa-prompt-feedback]');
    const load = () => {
      const value = this.runtime.getPrompt(selected.id);
      textarea.value = value; textarea.dataset.savedValue = value; count.textContent = value.length;
      mode.textContent = this.runtime.isPromptCustomized(selected.id) ? '已自定义' : '使用默认';
    };
    load();
    textarea.addEventListener('input', () => { count.textContent = textarea.value.length; feedback.textContent = textarea.value === textarea.dataset.savedValue ? '' : '有尚未保存的修改'; });
    root.querySelectorAll('[data-yssa-prompt-tool]').forEach((button) => button.addEventListener('click', () => {
      if (textarea.value !== textarea.dataset.savedValue && !window.confirm('当前修改尚未保存，确定切换吗？')) return;
      this.renderPromptSettings(button.dataset.yssaPromptTool);
    }));
    root.querySelector('[data-yssa-action="save-prompt"]')?.addEventListener('click', () => {
      try { const saved = this.runtime.savePrompt(selected.id, textarea.value); textarea.dataset.savedValue = saved; mode.textContent = '已自定义'; feedback.textContent = '已保存，下一次生成立即生效。'; } catch (error) { feedback.textContent = error.message; }
    });
    root.querySelector('[data-yssa-action="reset-prompt"]')?.addEventListener('click', () => { if (!window.confirm(`恢复“${selected.name}”的默认提示词？`)) return; const value = this.runtime.resetPrompt(selected.id); textarea.value = value; textarea.dataset.savedValue = value; count.textContent = value.length; mode.textContent = '使用默认'; feedback.textContent = '已恢复默认。'; });
    root.querySelector('[data-yssa-action="reset-all-prompts"]')?.addEventListener('click', () => { if (!window.confirm('恢复全部默认提示词？')) return; this.runtime.resetAllPrompts(); load(); feedback.textContent = '全部提示词已恢复默认。'; });
  }

  bindCommon(root) {
    root.querySelector('[data-yssa-action="phone-home"]')?.addEventListener('click', () => window.dispatchEvent(new CustomEvent('phone:goHome')));
    root.querySelector('[data-yssa-action="back-list"]')?.addEventListener('click', () => this.renderHome());
    root.querySelectorAll('[data-yssa-action="settings"]').forEach((button) => button.addEventListener('click', () => this.renderPromptSettings()));
    root.querySelector('[data-yssa-action="edit-prompt"]')?.addEventListener('click', () => this.renderPromptSettings(this.currentToolId));
    root.querySelectorAll('[data-yssa-action="open-mofo"]').forEach((button) => button.addEventListener('click', () => window.dispatchEvent(new CustomEvent('phone:openApp', { detail: { appId: 'mofo' } }))));
    root.querySelectorAll('[data-yssa-action="refresh-memory"]').forEach((button) => button.addEventListener('click', async () => {
      button.disabled = true;
      try { await this.runtime.refreshMemory('phone-app'); this.updateMemoryText(root); } finally { button.disabled = false; }
    }));
  }

  populateTargets(root) {
    const list = root.querySelector('#yssa-target-list');
    if (!list) return;
    this.runtime.getSuggestedTargets().forEach((name) => { const option = document.createElement('option'); option.value = name; list.appendChild(option); });
  }

  updateConnectionBadge(root = document.querySelector('.yssa-phone-app')) {
    const node = root?.querySelector('[data-yssa-connection]');
    if (!node) return;
    const status = this.runtime.getStatus();
    node.classList.toggle('is-connected', Boolean(status.phoneReady && status.mofoReady));
    node.title = status.phoneReady && status.mofoReady ? '手机与魔坊已连接' : '等待手机或魔坊';
  }

  updateMemoryText(root) {
    const node = root?.querySelector('[data-yssa-memory-text]');
    if (!node) return;
    const status = this.runtime.getStatus();
    node.textContent = status.memoryReady ? `记忆已连接${status.lastSync ? ` · ${status.lastSync}` : ''}` : '等待柚月记忆插件';
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
        ? '<span class="yssa-spinner"></span>正在生成…'
        : `<span>✦</span>${escapeHtml(generate.dataset.yssaIdleLabel || '生成并保存')}`;
    }
    if (stop) stop.hidden = !busy;
    root?.querySelectorAll('input, textarea').forEach((field) => { field.disabled = busy; });
  }

  async generate(toolId) {
    const root = document.querySelector('.yssa-phone-app');
    if (!root || this.busy) return;
    const target = root.querySelector('[data-yssa-target]')?.value || '';
    const extraInstructions = root.querySelector('[data-yssa-extra]')?.value || '';
    const continueFromCurrent = Boolean(root.querySelector('[data-yssa-continue]')?.checked);
    this.setBusy(root, true);
    this.setStatus(root, 'loading', 'AI 正在生成 App 内容', '已保存的旧内容会一直保留到本次成功。');
    try {
      await this.runtime.generateTool(toolId, { target, extraInstructions, continueFromCurrent });
      if (this.currentToolId !== toolId) return;
      this.socialPostId = '';
      this.renderTool(toolId);
      this.setStatus(document.querySelector('.yssa-phone-app'), 'success', '生成并保存完成', '现在看到的是完整 App 页面，不是字段预览。');
    } catch (error) {
      if (this.currentToolId !== toolId) return;
      const aborted = error?.name === 'AbortError';
      this.setStatus(document.querySelector('.yssa-phone-app'), aborted ? 'idle' : 'error', aborted ? '已停止生成' : '生成失败，可以重试', aborted ? '旧内容没有被改动。' : sanitizeGenerationError(error));
    } finally {
      if (this.currentToolId === toolId) this.setBusy(document.querySelector('.yssa-phone-app'), false);
      else this.busy = false;
    }
  }
}

export function openStoryStudioApp() {
  window.dispatchEvent(new CustomEvent('phone:openApp', { detail: { appId: APP_ID } }));
}
