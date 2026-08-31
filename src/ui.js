const APP_ID = 'yuzuki-story-state-addon';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function text(value, fallback = '未记录') {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

function entries(value) {
  return Object.values(value || {});
}

function summary(item) {
  return text(item?.summary || item?.overview || item?.content || item?.title || item?.name);
}

function parseAiJson(source) {
  const raw = String(source || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('AI 没有返回可识别的 JSON。');
  return JSON.parse(raw.slice(start, end + 1));
}

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export class StoryStateUI {
  constructor(runtime) {
    this.runtime = runtime;
    this.activeTab = 'overview';
    this.overlay = null;
    this.floatingButton = null;
    this.phoneRetry = null;
    this.phoneInstalled = false;
    this.surveyAbort = null;
    this.boundClick = (event) => this.handleClick(event);
    this.boundChange = (event) => this.handleChange(event);
    this.boundPhoneOpen = (event) => {
      if (event.detail?.appId === APP_ID) queueMicrotask(() => this.renderPhone());
    };
  }

  start() {
    document.addEventListener('click', this.boundClick);
    document.addEventListener('change', this.boundChange);
    globalThis.addEventListener('phone:openApp', this.boundPhoneOpen);
    this.ensureOverlay();
    this.syncFloatingButton();
    this.tryInstallPhoneTile();
    this.phoneRetry = setInterval(() => this.tryInstallPhoneTile(), 3000);
  }

  stop() {
    document.removeEventListener('click', this.boundClick);
    document.removeEventListener('change', this.boundChange);
    globalThis.removeEventListener('phone:openApp', this.boundPhoneOpen);
    clearInterval(this.phoneRetry);
    this.surveyAbort?.abort();
    this.overlay?.remove();
    this.floatingButton?.remove();
    this.overlay = null;
    this.floatingButton = null;
  }

  notify(message, type = 'info') {
    const toast = globalThis.toastr?.[type];
    if (typeof toast === 'function') toast(message, '柚月剧情状态');
    else console[type === 'error' ? 'error' : 'info'](`[柚月剧情状态] ${message}`);
  }

  ensureOverlay() {
    if (this.overlay?.isConnected) return;
    this.overlay = document.createElement('section');
    this.overlay.id = 'yssa-overlay';
    this.overlay.className = 'yssa-overlay yssa-hidden';
    this.overlay.setAttribute('aria-hidden', 'true');
    this.overlay.innerHTML = '<div class="yssa-backdrop" data-yssa-action="close"></div><div class="yssa-dialog" role="dialog" aria-modal="true"><div class="yssa-dialog-head"><strong>柚月剧情状态</strong><button type="button" data-yssa-action="close" aria-label="关闭">×</button></div><div class="yssa-overlay-content"></div></div>';
    document.body.append(this.overlay);
  }

  syncFloatingButton() {
    if (!this.runtime.settings.floatingButton) {
      this.floatingButton?.remove();
      this.floatingButton = null;
      return;
    }
    if (this.floatingButton?.isConnected) return;
    this.floatingButton = document.createElement('button');
    this.floatingButton.id = 'yssa-floating-button';
    this.floatingButton.type = 'button';
    this.floatingButton.dataset.yssaAction = 'open';
    this.floatingButton.title = '打开柚月剧情状态';
    this.floatingButton.textContent = '🧭';
    document.body.append(this.floatingButton);
  }

  tryInstallPhoneTile() {
    if (!this.runtime.settings.phoneTile) return false;
    const phone = globalThis.VirtualPhone;
    const apps = phone?.home?.apps;
    if (!Array.isArray(apps)) return false;
    if (!apps.some((app) => app?.id === APP_ID)) {
      apps.push({ id: APP_ID, name: '剧情状态', icon: '🧭', color: '#7457d9', badge: 0, data: { provider: 'yuzuki-story-state-addon' } });
    }
    this.phoneInstalled = true;
    return true;
  }

  capabilities() {
    const phone = globalThis.VirtualPhone;
    return {
      phone: Boolean(phone),
      phoneVersion: phone?.version || '未检测到',
      phoneAI: typeof phone?.apiManager?.callAI === 'function',
      memory: Boolean(globalThis.YuzukiMemory),
    };
  }

  renderShell() {
    const state = this.runtime.getState();
    const caps = this.capabilities();
    const tabs = [
      ['overview', '总览'], ['characters', '人物'], ['quests', '任务'],
      ['inventory', '背包'], ['chronicles', '纪要'], ['records', '更多'], ['investigations', '大调查'],
    ];
    return `<div class="yssa-root">
      <header class="yssa-hero"><div><span class="yssa-kicker">LOCAL STORY STATE</span><h2>剧情状态中心</h2><p>数据保存在当前聊天，不依赖 SP 数据库。</p></div><span class="yssa-revision">R${Number(state.revision || 0)}</span></header>
      <div class="yssa-capabilities"><span class="${caps.phone ? 'ok' : ''}">手机 ${escapeHtml(caps.phoneVersion)}</span><span class="${caps.phoneAI ? 'ok' : ''}">调查 AI</span><span class="${caps.memory ? 'ok' : ''}">柚月记忆</span></div>
      <nav class="yssa-tabs">${tabs.map(([id, label]) => `<button type="button" class="${this.activeTab === id ? 'active' : ''}" data-yssa-action="tab" data-tab="${id}">${label}</button>`).join('')}</nav>
      <main class="yssa-content">${this.renderTab(state)}</main>
      <footer class="yssa-tools"><button type="button" data-yssa-action="export">导出</button><button type="button" data-yssa-action="import">导入 / 迁移数据库</button><button type="button" data-yssa-action="copy-memory">复制记忆摘要</button><button type="button" class="danger" data-yssa-action="reset">清空</button><input class="yssa-file" type="file" accept="application/json,.json" data-yssa-file></footer>
      ${this.runtime.root.lastError ? `<div class="yssa-error">${escapeHtml(this.runtime.root.lastError)}</div>` : ''}
    </div>`;
  }

  renderTab(state) {
    if (this.activeTab === 'characters') return this.renderCharacters(state);
    if (this.activeTab === 'quests') return this.renderEntities(state.quests, '还没有任务记录。');
    if (this.activeTab === 'inventory') return this.renderEntities(state.inventory, '背包还没有物品记录。');
    if (this.activeTab === 'chronicles') return this.renderLogs(state.chronicles, '还没有剧情纪要。');
    if (this.activeTab === 'records') return this.renderRecords(state);
    if (this.activeTab === 'investigations') return this.renderInvestigations(state);
    return this.renderOverview(state);
  }

  renderOverview(state) {
    const location = state.scene.location || state.scene.place || state.global.location;
    const time = state.scene.time || state.global.time || state.global.date;
    const protagonist = state.protagonist.name || state.protagonist.姓名 || '主角';
    return `<div class="yssa-grid">
      <article class="yssa-card yssa-primary"><span>当前主角</span><strong>${escapeHtml(protagonist)}</strong><pre>${escapeHtml(text(state.protagonist, '等待剧情记录'))}</pre></article>
      <article class="yssa-card"><span>场景</span><strong>${escapeHtml(location || '地点未记录')}</strong><p>${escapeHtml(time || '时间未记录')}</p></article>
      <article class="yssa-card"><span>人物</span><strong>${entries(state.characters).length}</strong><p>已建立角色档案</p></article>
      <article class="yssa-card"><span>待办</span><strong>${entries(state.quests).filter((item) => !/完成|done|取消/i.test(String(item.status || ''))).length}</strong><p>未完任务</p></article>
      <article class="yssa-card wide"><span>最近纪要</span><p>${escapeHtml(state.chronicles.length ? summary(state.chronicles.at(-1)) : '等待下一轮剧情自动记录')}</p></article>
    </div>`;
  }

  renderCharacters(state) {
    const items = entries(state.characters);
    if (!items.length) return '<div class="yssa-empty">还没有人物档案。继续对话后，角色状态会随回复写入。</div>';
    return `<div class="yssa-list">${items.map((item) => `<article class="yssa-person"><div class="yssa-person-head"><div><strong>${escapeHtml(item.name || item.id)}</strong><small>${escapeHtml(item.identity || item.role || '身份未记录')}</small></div><button type="button" data-yssa-action="survey" data-character="${encodeURIComponent(item.id)}">大调查</button></div><p>${escapeHtml(item.attitude || item.relationship || item.personality || '关系与态度尚未记录')}</p><details><summary>完整档案</summary><pre>${escapeHtml(text(item))}</pre></details></article>`).join('')}</div>`;
  }

  renderEntities(map, empty) {
    const items = entries(map);
    if (!items.length) return `<div class="yssa-empty">${escapeHtml(empty)}</div>`;
    return `<div class="yssa-list">${items.map((item) => `<article class="yssa-row"><div><strong>${escapeHtml(item.title || item.name || item.id)}</strong><small>${escapeHtml(item.status || item.type || '')}</small></div><p>${escapeHtml(item.description || item.summary || item.effect || item.content || '暂无详情')}</p></article>`).join('')}</div>`;
  }

  renderLogs(items, empty) {
    if (!items.length) return `<div class="yssa-empty">${escapeHtml(empty)}</div>`;
    return `<div class="yssa-timeline">${[...items].reverse().map((item) => `<article><time>${escapeHtml(item.time || item.date || '')}</time><strong>${escapeHtml(item.title || item.type || '剧情记录')}</strong><p>${escapeHtml(summary(item))}</p></article>`).join('')}</div>`;
  }

  renderInvestigations(state) {
    const characters = entries(state.characters);
    const logs = state.investigations || [];
    return `<section class="yssa-survey"><div class="yssa-survey-callout"><div><strong>手动大调查</strong><p>只在你点击时调用一次 AI，不占用每轮剧情请求。</p></div>${characters.length ? `<select data-yssa-survey-select>${characters.map((item) => `<option value="${encodeURIComponent(item.id)}">${escapeHtml(item.name || item.id)}</option>`).join('')}</select><button type="button" data-yssa-action="survey-selected">开始调查</button>` : '<span>先让剧情记录至少一名角色</span>'}</div>${this.renderLogs(logs, '还没有调查报告。')}</section>`;
  }

  renderRecords(state) {
    return `<div class="yssa-list">
      <article class="yssa-card"><span>技能</span>${this.renderMiniList(entries(state.skills))}</article>
      <article class="yssa-card"><span>行动建议 / 检定</span>${this.renderMiniList(entries(state.checks))}</article>
      <article class="yssa-card"><span>关系里程碑</span>${this.renderMiniList(state.milestones)}</article>
      <article class="yssa-card"><span>恋爱日记</span>${this.renderMiniList(state.diaries)}</article>
      <article class="yssa-card"><span>全局状态</span><pre>${escapeHtml(text(state.global))}</pre></article>
      <article class="yssa-card"><span>其他迁移数据</span><pre>${escapeHtml(text(state.misc))}</pre></article>
    </div>`;
  }

  renderMiniList(items) {
    if (!items.length) return '<p>未记录</p>';
    return `<ul>${items.slice(-20).map((item) => `<li><strong>${escapeHtml(item.title || item.name || item.id || '记录')}</strong> ${escapeHtml(item.status || summary(item) || '')}</li>`).join('')}</ul>`;
  }

  renderOverlay() {
    this.ensureOverlay();
    this.overlay.querySelector('.yssa-overlay-content').innerHTML = this.renderShell();
  }

  renderPhone() {
    const shell = globalThis.VirtualPhone?.home?.phoneShell;
    if (typeof shell?.setContent !== 'function') {
      this.open();
      return;
    }
    shell.setContent(this.renderShell(), APP_ID);
  }

  rerender() {
    this.syncFloatingButton();
    if (this.overlay && !this.overlay.classList.contains('yssa-hidden')) this.renderOverlay();
    const phoneContent = document.querySelector(`[data-view-id="${APP_ID}"]`);
    if (phoneContent) this.renderPhone();
    this.tryInstallPhoneTile();
  }

  open() {
    this.renderOverlay();
    this.overlay.classList.remove('yssa-hidden');
    this.overlay.setAttribute('aria-hidden', 'false');
  }

  close() {
    this.overlay?.classList.add('yssa-hidden');
    this.overlay?.setAttribute('aria-hidden', 'true');
  }

  async handleClick(event) {
    const button = event.target.closest?.('[data-yssa-action]');
    if (!button) return;
    const action = button.dataset.yssaAction;
    if (action === 'open') return this.open();
    if (action === 'close') return this.close();
    if (action === 'tab') {
      this.activeTab = button.dataset.tab;
      return this.rerender();
    }
    if (action === 'export') {
      return downloadJson(`yuzuki-story-state-${Date.now()}.json`, this.runtime.exportData());
    }
    if (action === 'import') return button.closest('.yssa-root')?.querySelector('[data-yssa-file]')?.click();
    if (action === 'copy-memory') {
      await navigator.clipboard.writeText(this.runtime.getMemoryProjection());
      return this.notify('记忆摘要已复制。', 'success');
    }
    if (action === 'reset') {
      if (confirm('只清空当前聊天里的柚月剧情状态？原聊天消息不会删除。')) {
        await this.runtime.reset();
        this.notify('当前聊天状态已清空。', 'success');
      }
      return;
    }
    if (action === 'survey') return this.runSurvey(decodeURIComponent(button.dataset.character || ''));
    if (action === 'survey-selected') {
      const select = button.closest('.yssa-root')?.querySelector('[data-yssa-survey-select]');
      return this.runSurvey(decodeURIComponent(select?.value || ''));
    }
    if (action === 'stop-survey') {
      this.surveyAbort?.abort();
      this.runtime.context?.stopGeneration?.();
    }
  }

  async handleChange(event) {
    if (!event.target.matches?.('[data-yssa-file]') || !event.target.files?.[0]) return;
    try {
      const data = JSON.parse(await event.target.files[0].text());
      if (data?.format === 'yuzuki-story-state-addon') await this.runtime.importData(data);
      else await this.runtime.importLegacy(data);
      this.notify('导入完成，已写入当前聊天。', 'success');
    } catch (error) {
      this.notify(`导入失败：${error.message}`, 'error');
    } finally {
      event.target.value = '';
    }
  }

  async runSurvey(characterId) {
    const character = this.runtime.getState().characters[characterId];
    if (!character) return this.notify('没有找到这个角色。', 'error');
    if (this.surveyAbort) return this.notify('已有一项调查正在进行。');
    this.surveyAbort = new AbortController();
    this.notify(`正在调查 ${character.name || character.id}…`);
    try {
      const prompt = [
        '请根据对话上下文和下列角色档案，生成一次角色“大调查”。',
        '只输出 JSON 对象：{"title":"...","summary":"...","identity":"...","relationship":"...","secrets":["..."],"evidence":["..."],"uncertainties":["..."]}。',
        '不确定的信息必须放入 uncertainties，不可当作事实。',
        JSON.stringify(character),
      ].join('\n');
      let raw;
      const phoneAI = globalThis.VirtualPhone?.apiManager?.callAI;
      if (typeof phoneAI === 'function') {
        const result = await phoneAI([{ role: 'user', content: prompt }], { appId: APP_ID, signal: this.surveyAbort.signal });
        if (!result?.success) throw new Error(result?.error || '柚月手机 AI 调用失败');
        raw = result.summary;
      } else {
        raw = await this.runtime.context.generateRaw({ prompt, systemPrompt: '你是严谨的剧情档案调查员。', responseLength: 1800 });
      }
      const report = parseAiJson(raw);
      await this.runtime.applyManualPatch({ append: { investigations: [{ ...report, characterId, characterName: character.name || character.id, time: new Date().toLocaleString('zh-CN') }] } }, 'investigation');
      this.activeTab = 'investigations';
      this.notify('大调查已保存到当前聊天。', 'success');
    } catch (error) {
      if (error.name !== 'AbortError') this.notify(`大调查失败：${error.message}`, 'error');
    } finally {
      this.surveyAbort = null;
      this.rerender();
    }
  }
}
