import { GENERATION_TOOLS, sanitizeGenerationError } from './generation-service.js';

const APP_ID = 'yssa-story-studio';
const APP_ICON = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#9684ef"/><stop offset="1" stop-color="#51439d"/></linearGradient></defs>
    <rect width="128" height="128" rx="30" fill="url(#g)"/>
    <path d="M34 37c13-4 23-1 30 7 7-8 17-11 30-7v54c-12-3-22 0-30 8-8-8-18-11-30-8V37Z" fill="none" stroke="#fff" stroke-width="7" stroke-linejoin="round"/>
    <path d="M64 45v53M81 22l3 9 9 3-9 3-3 9-3-9-9-3 9-3 3-9Z" fill="#fff" stroke="#fff" stroke-linejoin="round"/>
  </svg>`)} `;
const APP_DESCRIPTOR = Object.freeze({
  id: APP_ID,
  name: '剧情工坊',
  icon: '✦',
  defaultIcon: APP_ICON.trim(),
  color: '#7664dc',
  badge: 0,
  data: {},
});

const FIELD_LABELS = Object.freeze({
  chapter: '章节 / 场景', time: '剧情时间', location: '地点', weather: '环境', participants: '在场角色',
  objective: '当前目标', tension: '紧张度', relationship: '关系气氛', condition: '身体 / 情绪', items: '关键物品',
  clues: '已确认线索', next: '下一步', note: '备注', title: '报告标题', target: '调查对象', conclusion: '结论',
  profile: '人物侧写', evidence: '证据', secrets: '秘密 / 疑点', uncertainties: '不确定信息', recommendation: '建议',
  gender: '性别', age: '年龄', portrait: '特写', bodyData: '身材数据', dailyStyle: '日常服装风格',
  privateStyle: '私密服装风格', makeupStyle: '妆容风格', orientation: '性取向', kinks: '核心性癖',
  shame: '羞耻指数', confidence: '性自信指数', openness: '性开放度', virginity: '是否为处女 / 处男',
  firstPartner: '破处对象 / 时间', purityScore: '纯洁值综合评分', purityDetails: '部位纯洁度明细',
  sexCount: '性爱次数', partnerCount: '性爱人数', partners: '主要性爱名单', frequency: '性爱频率',
  positions: '最常使用体位', locations: '性爱场所分布', fertilitySummary: '生育次数概览',
  fertilityHistory: '详细生育记录', oralDevelopment: '口部开发', handDevelopment: '手部开发',
  footDevelopment: '足部开发', breastDevelopment: '乳部开发', penisDevelopment: '阳具开发',
  genitalDevelopment: '阴部开发', analDevelopment: '肛部开发', masturbationCount: '自慰总次数',
  masturbationFrequency: '自慰频率', firstMasturbation: '第一次自慰', masturbationMethod: '常用自慰方式',
  firstExperience: '第一次性经历', recentExperience: '最近一次性经历', bestExperience: '最爽一次性经历',
  charmTypes: '魅力类型', eroticTags: '色情分类 TAG', globalRank: '全球排名', grade: '品级评定',
  advantages: '排名优势因素', disadvantages: '排名劣势因素', attractivePart: '最具性吸引力部位',
  voiceProfile: '声音档案', rumors: '流言与评价', userNote: '使用者备注', selfReview: '人物自评',
  updatedAt: '剧情内时间', total: '已解锁总数', latest: '最新成就', progress: '进行中的目标', author: '发布者',
  handle: '账号', avatar: '头像', bio: '简介', p1Tag: '笔记一标签', p1Title: '笔记一标题', p1Body: '笔记一正文',
  p1Likes: '笔记一点赞', p1Comments: '笔记一评论', p2Tag: '笔记二标签', p2Title: '笔记二标题', p2Body: '笔记二正文',
  p2Likes: '笔记二点赞', p2Comments: '笔记二评论', p3Tag: '笔记三标签', p3Title: '笔记三标题', p3Body: '笔记三正文',
  p3Likes: '笔记三点赞', p3Comments: '笔记三评论',
});

function createElement(tag, className = '', content = '') {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content !== '') element.textContent = String(content);
  return element;
}

function formatValue(value) {
  if (value === null || value === undefined || value === '') return '暂无';
  if (typeof value === 'object') {
    try { return JSON.stringify(value, null, 2); } catch (_error) { return String(value); }
  }
  return String(value);
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
  }

  start() {
    if (this.active || typeof window === 'undefined') return;
    this.active = true;
    this.abortController = new AbortController();
    const signal = this.abortController.signal;
    window.addEventListener('phone:openApp', (event) => {
      if (event?.detail?.appId !== APP_ID) return;
      // The official phone routes unknown IDs to a generic “under development” notice.
      // This external app owns its ID, so consume only this event before that fallback.
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
      const notify = window.toastr?.info;
      if (typeof notify === 'function') notify('请先打开一次柚月手机，再点击“剧情工坊”图标。', '柚月剧情工坊');
      return false;
    }
    const panel = document.getElementById('phone-panel');
    const drawerButton = document.getElementById('phoneDrawerIcon');
    const panelIsOpen = panel?.classList.contains('phone-panel-open')
      && !panel?.classList.contains('phone-panel-hidden');
    if (!panelIsOpen && typeof drawerButton?.click === 'function') drawerButton.click();
    this.pendingView = view;
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('phone:openApp', { detail: { appId: APP_ID } }));
    }, panelIsOpen ? 0 : 120);
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

  baseHeader(title, subtitle, backAction = 'home', trailingAction = '') {
    const trailingLabel = trailingAction === 'settings' ? '提示词设置' : '编辑当前提示词';
    const trailing = trailingAction
      ? `<button type="button" class="yssa-icon-button yssa-icon-button--small" data-yssa-action="${trailingAction}" aria-label="${trailingLabel}">${trailingAction === 'settings' ? '⚙' : '✎'}</button>`
      : '<span class="yssa-connection-dot" data-yssa-connection aria-label="连接状态"></span>';
    return `
      <header class="yssa-app-header">
        <button type="button" class="yssa-icon-button" data-yssa-action="${backAction}" aria-label="返回">‹</button>
        <div><small>${subtitle}</small><h1>${title}</h1></div>
        ${trailing}
      </header>`;
  }

  renderHome() {
    this.currentToolId = '';
    const toolCards = GENERATION_TOOLS.map((tool) => `
      <button type="button" class="yssa-tool-card yssa-tool-card--${tool.key}" data-yssa-tool="${tool.id}">
        <span class="yssa-tool-icon">${tool.icon}</span>
        <span class="yssa-tool-copy"><small>${tool.eyebrow}</small><strong>${tool.name}</strong><em>${tool.description}</em></span>
        <span class="yssa-tool-chevron">›</span>
      </button>`).join('');

    const root = this.setContent(`
      <main class="yssa-phone-app yssa-studio-home">
        ${this.baseHeader('剧情工坊', 'YUZUKI STORY STUDIO', 'home', 'settings')}
        <div class="yssa-app-scroll">
          <section class="yssa-studio-hero">
            <span>✦</span>
            <div><small>MANUAL AI WORKSPACE</small><h2>需要时再生成</h2><p>一次只更新一个魔坊页面，不填数据库，也不打断正文回复。</p></div>
          </section>
          <section class="yssa-memory-strip">
            <div><small>YUZUKI MEMORY</small><strong>记忆快照</strong><p data-yssa-memory-text>读取当前会话记忆</p></div>
            <button type="button" data-yssa-action="refresh-memory">刷新</button>
          </section>
          <section class="yssa-tool-list" aria-label="生成工具">${toolCards}</section>
          <footer class="yssa-studio-footer">
            <button type="button" data-yssa-action="open-mofo">打开魔坊查看全部页面</button>
            <p>内容保存到当前聊天的魔坊状态；切换聊天后彼此独立。</p>
          </footer>
        </div>
      </main>`, 'yssa-story-studio-home');
    if (!root) return;
    this.bindCommon(root);
    root.querySelectorAll('[data-yssa-tool]').forEach((button) => {
      button.addEventListener('click', () => this.renderTool(button.dataset.yssaTool));
    });
    this.updateConnectionBadge(root);
    this.updateMemoryText(root);
  }

  renderTool(toolId) {
    const tool = GENERATION_TOOLS.find((candidate) => candidate.id === toolId);
    if (!tool) return this.renderHome();
    this.currentToolId = toolId;
    const targetField = tool.needsTarget ? `
      <label class="yssa-target-field">
        <span>调查对象</span>
        <input type="text" data-yssa-target list="yssa-target-list" maxlength="80" placeholder="输入角色姓名" autocomplete="off">
        <datalist id="yssa-target-list"></datalist>
      </label>` : '';
    const investigationOptions = tool.key === 'investigation' ? `
      <section class="yssa-investigation-options">
        <label><span>本次额外调查要求（可选）</span><textarea data-yssa-extra rows="4" maxlength="4000" placeholder="例如：侧重心理描写、补充某段经历，只对本次生成生效。"></textarea></label>
        <label class="yssa-switch-row"><input type="checkbox" data-yssa-continue><span><strong>接续当前档案</strong><small>把魔坊中现有档案作为基线，结合最新剧情生成完整新版。</small></span></label>
      </section>` : '';
    const root = this.setContent(`
      <main class="yssa-phone-app yssa-tool-page yssa-tool-page--${tool.key}">
        ${this.baseHeader(tool.name, tool.eyebrow, 'back-list', 'edit-prompt')}
        <div class="yssa-app-scroll">
          <section class="yssa-tool-intro">
            <span>${tool.icon}</span><div><h2>${tool.name}</h2><p>${tool.description}</p></div>
          </section>
          ${targetField}
          ${investigationOptions}
          <section class="yssa-generation-status" data-yssa-generation-status aria-live="polite">
            <span class="yssa-status-orb"></span>
            <div><strong>准备就绪</strong><p>点击下方按钮后才会调用 AI。</p></div>
          </section>
          <section class="yssa-result-section">
            <div class="yssa-section-heading"><div><small>CURRENT RESULT</small><h2>当前内容</h2></div><button type="button" data-yssa-action="open-mofo">魔坊预览</button></div>
            <div class="yssa-result-grid" data-yssa-result></div>
          </section>
        </div>
        <div class="yssa-generation-bar">
          <button type="button" class="yssa-stop-button" data-yssa-action="stop" hidden>停止</button>
          <button type="button" class="yssa-generate-button" data-yssa-action="generate"><span>✦</span> 生成并保存</button>
        </div>
      </main>`, `yssa-story-studio-${tool.key}`);
    if (!root) return;
    this.bindCommon(root);
    root.querySelector('[data-yssa-action="generate"]')?.addEventListener('click', () => this.generate(toolId));
    root.querySelector('[data-yssa-action="stop"]')?.addEventListener('click', () => this.runtime.cancelGeneration());
    this.populateTargets(root);
    this.renderCurrentState(root, toolId);
    this.updateConnectionBadge(root);
    this.setBusy(root, this.busy);
  }

  renderPromptSettings(toolId = this.promptToolId) {
    const selected = GENERATION_TOOLS.find((tool) => tool.id === toolId) || GENERATION_TOOLS[0];
    this.promptToolId = selected.id;
    this.currentToolId = '';
    const tabs = GENERATION_TOOLS.map((tool) => `
      <button type="button" class="${tool.id === selected.id ? 'is-active' : ''}" data-yssa-prompt-tool="${tool.id}">
        <span>${tool.icon}</span><strong>${tool.name}</strong>
      </button>`).join('');
    const root = this.setContent(`
      <main class="yssa-phone-app yssa-prompt-settings">
        ${this.baseHeader('生成提示词', 'PROMPT SETTINGS', 'back-list')}
        <div class="yssa-app-scroll">
          <section class="yssa-prompt-notice">
            <strong>每个功能都可以单独修改</strong>
            <p>保存后只影响剧情工坊的手动生成，不会修改柚月手机、记忆插件或魔坊里的其他内容。</p>
          </section>
          <nav class="yssa-prompt-tabs" aria-label="选择功能">${tabs}</nav>
          <section class="yssa-prompt-editor">
            <div class="yssa-section-heading"><div><small>${selected.eyebrow}</small><h2>${selected.name}</h2></div><span data-yssa-prompt-mode></span></div>
            <label for="yssa-prompt-text">生成提示词</label>
            <textarea id="yssa-prompt-text" data-yssa-prompt-text maxlength="32000" spellcheck="false"></textarea>
            <p><span data-yssa-prompt-count>0</span> / 32000 字符。模型仍会被要求只返回模板字段对应的 JSON。</p>
            <div class="yssa-prompt-actions">
              <button type="button" data-yssa-action="reset-prompt">恢复此项默认</button>
              <button type="button" class="is-primary" data-yssa-action="save-prompt">保存提示词</button>
            </div>
          </section>
          <button type="button" class="yssa-reset-all" data-yssa-action="reset-all-prompts">恢复全部默认提示词</button>
          <p class="yssa-prompt-feedback" data-yssa-prompt-feedback aria-live="polite"></p>
        </div>
      </main>`, 'yssa-story-studio-prompt-settings');
    if (!root) return;
    this.bindCommon(root);
    const textarea = root.querySelector('[data-yssa-prompt-text]');
    const count = root.querySelector('[data-yssa-prompt-count]');
    const mode = root.querySelector('[data-yssa-prompt-mode]');
    const feedback = root.querySelector('[data-yssa-prompt-feedback]');
    const loadPrompt = () => {
      const value = this.runtime.getPrompt(selected.id);
      textarea.value = value;
      textarea.dataset.savedValue = value;
      count.textContent = String(value.length);
      mode.textContent = this.runtime.isPromptCustomized(selected.id) ? '已自定义' : '使用默认';
      mode.classList.toggle('is-custom', this.runtime.isPromptCustomized(selected.id));
    };
    loadPrompt();
    textarea.addEventListener('input', () => {
      count.textContent = String(textarea.value.length);
      feedback.textContent = textarea.value === textarea.dataset.savedValue ? '' : '有尚未保存的修改';
    });
    root.querySelectorAll('[data-yssa-prompt-tool]').forEach((button) => {
      button.addEventListener('click', () => {
        if (textarea.value !== textarea.dataset.savedValue && !window.confirm('当前修改尚未保存，确定切换吗？')) return;
        this.renderPromptSettings(button.dataset.yssaPromptTool);
      });
    });
    root.querySelector('[data-yssa-action="save-prompt"]')?.addEventListener('click', () => {
      try {
        const saved = this.runtime.savePrompt(selected.id, textarea.value);
        textarea.value = saved;
        textarea.dataset.savedValue = saved;
        mode.textContent = '已自定义';
        mode.classList.add('is-custom');
        feedback.textContent = '已保存，下一次生成立即生效。';
      } catch (error) {
        feedback.textContent = error.message;
      }
    });
    root.querySelector('[data-yssa-action="reset-prompt"]')?.addEventListener('click', () => {
      if (!window.confirm(`恢复“${selected.name}”的默认提示词？`)) return;
      const value = this.runtime.resetPrompt(selected.id);
      textarea.value = value;
      textarea.dataset.savedValue = value;
      count.textContent = String(value.length);
      mode.textContent = '使用默认';
      mode.classList.remove('is-custom');
      feedback.textContent = '已恢复此项默认提示词。';
    });
    root.querySelector('[data-yssa-action="reset-all-prompts"]')?.addEventListener('click', () => {
      if (!window.confirm('恢复全部四项默认提示词？')) return;
      this.runtime.resetAllPrompts();
      loadPrompt();
      feedback.textContent = '全部提示词已恢复默认。';
    });
  }

  bindCommon(root) {
    root.querySelector('[data-yssa-action="home"]')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('phone:goHome'));
    });
    root.querySelector('[data-yssa-action="back-list"]')?.addEventListener('click', () => this.renderHome());
    root.querySelector('[data-yssa-action="settings"]')?.addEventListener('click', () => this.renderPromptSettings());
    root.querySelector('[data-yssa-action="edit-prompt"]')?.addEventListener('click', () => this.renderPromptSettings(this.currentToolId));
    root.querySelectorAll('[data-yssa-action="open-mofo"]').forEach((button) => {
      button.addEventListener('click', () => window.dispatchEvent(new CustomEvent('phone:openApp', { detail: { appId: 'mofo' } })));
    });
    root.querySelector('[data-yssa-action="refresh-memory"]')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = '刷新中';
      try {
        await this.runtime.refreshMemory('phone-app');
        this.updateMemoryText(root);
      } finally {
        button.disabled = false;
        button.textContent = '刷新';
      }
    });
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
    if (!root) return;
    const status = this.runtime.getStatus();
    const node = root.querySelector('[data-yssa-connection]');
    if (!node) return;
    const connected = Boolean(status?.phoneReady && status?.mofoReady);
    node.classList.toggle('is-connected', connected);
    node.title = connected ? '手机与魔坊已连接' : '等待手机或魔坊';
  }

  updateMemoryText(root) {
    const node = root?.querySelector('[data-yssa-memory-text]');
    if (!node) return;
    const status = this.runtime.getStatus();
    node.textContent = status?.memoryReady
      ? `已连接${status.lastSync ? ` · ${status.lastSync}` : ''}`
      : '等待柚月记忆插件';
  }

  renderCurrentState(root, toolId, stateOverride = null) {
    const result = root?.querySelector('[data-yssa-result]');
    if (!result) return;
    result.replaceChildren();
    const item = this.runtime.getGenerationItem(toolId);
    const state = stateOverride || item?.state || item?.initialState || {};
    const entries = Object.entries(state);
    if (!entries.length) {
      result.appendChild(createElement('p', 'yssa-result-empty', '暂无内容，请先生成。'));
      return;
    }
    entries.forEach(([key, value]) => {
      const article = createElement('article', 'yssa-result-field');
      article.appendChild(createElement('small', '', FIELD_LABELS[key] || key));
      article.appendChild(createElement('p', '', formatValue(value)));
      result.appendChild(article);
    });
  }

  setStatus(root, mode, title, detail) {
    const box = root?.querySelector('[data-yssa-generation-status]');
    if (!box) return;
    box.dataset.mode = mode;
    const titleNode = box.querySelector('strong');
    const detailNode = box.querySelector('p');
    if (titleNode) titleNode.textContent = title;
    if (detailNode) detailNode.textContent = detail;
  }

  setBusy(root, busy) {
    this.busy = busy;
    root?.setAttribute('aria-busy', busy ? 'true' : 'false');
    const generateButton = root?.querySelector('[data-yssa-action="generate"]');
    const stopButton = root?.querySelector('[data-yssa-action="stop"]');
    const target = root?.querySelector('[data-yssa-target]');
    const extra = root?.querySelector('[data-yssa-extra]');
    const continuation = root?.querySelector('[data-yssa-continue]');
    if (generateButton) {
      generateButton.disabled = busy;
      generateButton.innerHTML = busy ? '<span class="yssa-spinner"></span> 正在生成…' : '<span>✦</span> 生成并保存';
    }
    if (stopButton) stopButton.hidden = !busy;
    if (target) target.disabled = busy;
    if (extra) extra.disabled = busy;
    if (continuation) continuation.disabled = busy;
  }

  async generate(toolId) {
    const root = document.querySelector('.yssa-phone-app');
    if (!root || this.busy) return;
    const target = root.querySelector('[data-yssa-target]')?.value || '';
    const extraInstructions = root.querySelector('[data-yssa-extra]')?.value || '';
    const continueFromCurrent = Boolean(root.querySelector('[data-yssa-continue]')?.checked);
    this.setBusy(root, true);
    this.setStatus(root, 'loading', 'AI 正在整理剧情', '页面可以停留在这里，也可以随时点击停止。');
    try {
      const result = await this.runtime.generateTool(toolId, { target, extraInstructions, continueFromCurrent });
      if (this.currentToolId !== toolId) return;
      const currentRoot = document.querySelector('.yssa-phone-app');
      this.renderCurrentState(currentRoot, toolId, result.state);
      this.setStatus(currentRoot, 'success', '生成并保存完成', '结果已经写入当前聊天的魔坊页面。');
    } catch (error) {
      if (this.currentToolId !== toolId) return;
      const currentRoot = document.querySelector('.yssa-phone-app');
      const aborted = error?.name === 'AbortError';
      this.setStatus(
        currentRoot,
        aborted ? 'idle' : 'error',
        aborted ? '已停止生成' : '生成失败，可以重试',
        aborted ? '没有改动当前魔坊内容。' : sanitizeGenerationError(error),
      );
    } finally {
      if (this.currentToolId === toolId) this.setBusy(document.querySelector('.yssa-phone-app'), false);
      else this.busy = false;
    }
  }
}

export function openStoryStudioApp() {
  window.dispatchEvent(new CustomEvent('phone:openApp', { detail: { appId: APP_ID } }));
}
