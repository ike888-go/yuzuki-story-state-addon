import { readMemorySnapshot, hasMemoryRuntime } from './memory-adapter.js';
import { installMissingItems, resolveMofoData, updateItemState, upgradeManagedItems } from './mofo-adapter.js';
import { clonePack, loadImportPack, MEMORY_ITEM_ID } from './pack-registry.js';
import { GenerationService, GENERATION_TOOLS } from './generation-service.js';

export const EXTENSION_KEY = 'yuzuki_story_state_addon';

const DEFAULT_SETTINGS = Object.freeze({
  autoInstall: true,
  memorySync: true,
  packRevision: 0,
  promptOverrides: {},
});

const CONTENT_REVISION = 2;
const RETRY_DELAYS = Object.freeze([800, 1800, 4000, 9000, 18000, 30000]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export class ContentAddonRuntime {
  constructor(onStatus = () => {}) {
    this.onStatus = onStatus;
    this.context = null;
    this.settings = { ...DEFAULT_SETTINGS };
    this.pack = null;
    this.active = false;
    this.listeners = [];
    this.windowListeners = [];
    this.retryTimer = null;
    this.pendingTimers = new Set();
    this.retryIndex = 0;
    this.syncChain = Promise.resolve();
    this.generation = new GenerationService(
      () => this.getContext(),
      (toolId) => this.getPrompt(toolId),
    );
    this.status = {
      active: false,
      phoneReady: false,
      mofoReady: false,
      memoryReady: false,
      installedCount: 0,
      existingCount: 0,
      conflictCount: 0,
      lastSync: '',
      message: '尚未启动',
    };
  }

  getContext() {
    const context = globalThis.SillyTavern?.getContext?.();
    if (!context) throw new Error('未找到 SillyTavern.getContext。');
    return context;
  }

  async loadPack() {
    if (!this.pack) this.pack = await loadImportPack();
    return clonePack(this.pack);
  }

  getImportPack() {
    return this.pack ? clonePack(this.pack) : null;
  }

  getStatus() {
    return clone(this.status);
  }

  getGenerationTools() {
    return GENERATION_TOOLS.map((tool) => ({ ...tool }));
  }

  getGenerationItem(toolId) {
    return this.generation.getItem(toolId);
  }

  getDefaultPrompt(toolId) {
    const item = this.pack?.items?.find((candidate) => candidate.id === toolId);
    return String(item?.promptTemplate || '');
  }

  getPrompt(toolId) {
    const override = this.settings.promptOverrides?.[toolId];
    return typeof override === 'string' && override.trim() ? override : this.getDefaultPrompt(toolId);
  }

  isPromptCustomized(toolId) {
    return typeof this.settings.promptOverrides?.[toolId] === 'string'
      && Boolean(this.settings.promptOverrides[toolId].trim());
  }

  savePrompt(toolId, value) {
    if (!GENERATION_TOOLS.some((tool) => tool.id === toolId)) throw new Error('未知的提示词项目。');
    const prompt = String(value || '').replace(/\u0000/g, '').trim();
    if (!prompt) throw new Error('提示词不能为空；如需恢复，请使用“恢复默认”。');
    if (prompt.length > 32000) throw new Error('提示词不能超过 32000 个字符。');
    this.settings.promptOverrides = { ...(this.settings.promptOverrides || {}), [toolId]: prompt };
    this.context.extensionSettings[EXTENSION_KEY] = this.settings;
    this.context.saveSettingsDebounced?.();
    return prompt;
  }

  resetPrompt(toolId) {
    const next = { ...(this.settings.promptOverrides || {}) };
    delete next[toolId];
    this.settings.promptOverrides = next;
    this.context.extensionSettings[EXTENSION_KEY] = this.settings;
    this.context.saveSettingsDebounced?.();
    return this.getDefaultPrompt(toolId);
  }

  resetAllPrompts() {
    this.settings.promptOverrides = {};
    this.context.extensionSettings[EXTENSION_KEY] = this.settings;
    this.context.saveSettingsDebounced?.();
  }

  getSuggestedTargets() {
    return this.generation.getSuggestedTargets();
  }

  generateTool(toolId, options = {}) {
    return this.generation.generate(toolId, options);
  }

  cancelGeneration() {
    this.generation.cancel();
  }

  setStatus(patch) {
    this.status = { ...this.status, ...patch };
    this.onStatus(this.getStatus());
    globalThis.dispatchEvent?.(new CustomEvent('yuzuki-content-addon:status', {
      detail: this.getStatus(),
    }));
  }

  bindContextEvent(event, handler) {
    if (!event || typeof this.context?.eventSource?.on !== 'function') return;
    this.context.eventSource.on(event, handler);
    this.listeners.push([event, handler]);
  }

  bindWindowEvent(event, handler) {
    if (typeof globalThis.addEventListener !== 'function') return;
    globalThis.addEventListener(event, handler);
    this.windowListeners.push([event, handler]);
  }

  bindEvents() {
    const events = this.context.eventTypes || this.context.event_types || {};
    this.bindContextEvent(events.APP_READY, () => this.scheduleSync('app-ready', 0));
    this.bindContextEvent(events.CHAT_CHANGED, () => this.scheduleSync('chat-changed', 350));
    this.bindContextEvent(events.MESSAGE_RECEIVED, () => this.scheduleSync('message-received', 250));
    this.bindWindowEvent('yzm-memory-state-updated', () => this.scheduleMemoryRefresh('memory-updated', 80));
    this.bindWindowEvent('yzm-memory-session-ready', () => this.scheduleMemoryRefresh('memory-session-ready', 80));
  }

  shouldAutoInstall() {
    return this.settings.autoInstall && Number(this.settings.packRevision || 0) < CONTENT_REVISION;
  }

  setTimer(callback, delay) {
    const timer = globalThis.setTimeout?.(() => {
      this.pendingTimers.delete(timer);
      callback();
    }, delay);
    if (timer !== undefined && timer !== null) this.pendingTimers.add(timer);
    return timer;
  }

  clearTimer(timer) {
    if (timer === undefined || timer === null) return;
    globalThis.clearTimeout?.(timer);
    this.pendingTimers.delete(timer);
  }

  async start() {
    if (this.active) return this.getStatus();
    this.context = this.getContext();
    const stored = this.context.extensionSettings?.[EXTENSION_KEY];
    this.settings = { ...DEFAULT_SETTINGS, ...(stored && typeof stored === 'object' ? stored : {}) };
    this.settings.promptOverrides = this.settings.promptOverrides && typeof this.settings.promptOverrides === 'object'
      ? { ...this.settings.promptOverrides }
      : {};
    this.context.extensionSettings[EXTENSION_KEY] = this.settings;
    this.context.saveSettingsDebounced?.();
    this.active = true;
    this.bindEvents();
    await this.loadPack();
    this.setStatus({ active: true, message: '正在连接柚月手机与记忆插件…' });
    if (this.shouldAutoInstall()) await this.installMissing('startup');
    else await this.refreshMemory('startup');
    return this.getStatus();
  }

  stop() {
    if (!this.active) return;
    this.cancelGeneration();
    for (const [event, handler] of this.listeners) {
      if (typeof this.context?.eventSource?.off === 'function') this.context.eventSource.off(event, handler);
      else this.context?.eventSource?.removeListener?.(event, handler);
    }
    for (const [event, handler] of this.windowListeners) globalThis.removeEventListener?.(event, handler);
    this.listeners = [];
    this.windowListeners = [];
    if (this.retryTimer) this.clearTimer(this.retryTimer);
    for (const timer of this.pendingTimers) globalThis.clearTimeout?.(timer);
    this.pendingTimers.clear();
    this.retryTimer = null;
    this.active = false;
    this.setStatus({ active: false, message: '扩展已停用' });
  }

  scheduleSync(reason, delay = 0) {
    if (!this.active) return;
    if (this.retryTimer) this.clearTimer(this.retryTimer);
    this.retryTimer = this.setTimer(() => {
      this.retryTimer = null;
      const action = this.shouldAutoInstall()
        ? this.installMissing(reason)
        : this.refreshMemory(reason);
      action.catch((error) => this.handleError(error));
    }, delay);
  }

  scheduleMemoryRefresh(reason, delay = 0) {
    if (!this.active) return;
    this.setTimer(() => {
      this.refreshMemory(reason).catch((error) => this.handleError(error));
    }, delay);
  }

  scheduleRetry() {
    if (!this.active || this.retryTimer || this.retryIndex >= RETRY_DELAYS.length) return;
    const delay = RETRY_DELAYS[this.retryIndex];
    this.retryIndex += 1;
    this.retryTimer = this.setTimer(() => {
      this.retryTimer = null;
      const action = this.shouldAutoInstall()
        ? this.installMissing('phone-wait')
        : this.refreshMemory('phone-wait');
      action.catch((error) => this.handleError(error));
    }, delay);
  }

  handleError(error) {
    console.error('[柚月魔坊内容增量包]', error);
    this.setStatus({ message: `操作失败：${error.message}` });
  }

  installMissing(reason = 'manual') {
    this.syncChain = this.syncChain.then(async () => {
      if (!this.active) return this.getStatus();
      const pack = await this.loadPack();
      const phone = globalThis.VirtualPhone;
      const mofoData = resolveMofoData(globalThis);
      const memoryReady = hasMemoryRuntime(globalThis.YuzukiMemory);

      if (!mofoData) {
        this.setStatus({
          phoneReady: Boolean(phone),
          mofoReady: false,
          memoryReady,
          message: phone
            ? '等待魔坊数据层；打开一次柚月手机的魔坊即可继续。'
            : '未检测到柚月手机。也可以先下载魔坊导入包手动导入。',
        });
        this.scheduleRetry();
        return this.getStatus();
      }

      this.retryIndex = 0;
      const previousRevision = Number(this.settings.packRevision || 0);
      const manualInstall = reason === 'settings' || reason === 'public-api';
      const result = previousRevision === 0 || manualInstall
        ? installMissingItems(mofoData, pack)
        : { installed: [], existing: [], conflicts: [] };
      const upgraded = previousRevision < 2
        ? upgradeManagedItems(mofoData, pack, ['yssa_investigation_report'])
        : [];
      this.settings.packRevision = CONTENT_REVISION;
      this.context.saveSettingsDebounced?.();
      this.setStatus({
        phoneReady: true,
        mofoReady: true,
        memoryReady,
        installedCount: result.installed.length,
        existingCount: result.existing.length,
        conflictCount: result.conflicts.length,
        message: result.conflicts.length
          ? `已连接魔坊，但有 ${result.conflicts.length} 个同名模板未自动覆盖。`
          : (upgraded.length
              ? '角色大调查已升级为原版完整档案结构。'
              : (result.installed.length ? `已安装 ${result.installed.length} 个缺失模板。` : '魔坊内容模板已就绪。')),
      });
      if (this.settings.memorySync) await this.refreshMemoryNow(reason, mofoData);
      return this.getStatus();
    }).catch((error) => {
      this.handleError(error);
      return this.getStatus();
    });
    return this.syncChain;
  }

  refreshMemory(reason = 'manual') {
    this.syncChain = this.syncChain.then(() => this.refreshMemoryNow(reason)).catch((error) => {
      this.handleError(error);
      return this.getStatus();
    });
    return this.syncChain;
  }

  async refreshMemoryNow(reason = 'manual', suppliedMofoData = null) {
    if (!this.active) return this.getStatus();
    const mofoData = suppliedMofoData || resolveMofoData(globalThis);
    const snapshot = readMemorySnapshot(globalThis.YuzukiMemory);
    if (!mofoData) {
      this.setStatus({
        phoneReady: Boolean(globalThis.VirtualPhone),
        mofoReady: false,
        memoryReady: snapshot.available,
        message: '记忆快照尚未写入：魔坊数据层未就绪。',
      });
      this.scheduleRetry();
      return this.getStatus();
    }

    const updated = updateItemState(mofoData, MEMORY_ITEM_ID, snapshot.state, 'yuzuki-memory-readonly');
    const timestamp = new Date().toLocaleString('zh-CN', { hour12: false });
    this.setStatus({
      phoneReady: true,
      mofoReady: true,
      memoryReady: snapshot.available,
      lastSync: updated ? timestamp : this.status.lastSync,
      message: updated
        ? (snapshot.available ? `记忆快照已只读刷新（${reason}）。` : '魔坊已就绪，正在等待柚月记忆插件。')
        : '找不到记忆快照模板，请先安装缺失内容。',
    });
    return this.getStatus();
  }
}
