import { readMemorySnapshot, hasMemoryRuntime } from './memory-adapter.js';
import { cloneContentRegistry, loadContentRegistry } from './content-registry.js';
import { GenerationService, GENERATION_TOOLS } from './generation-service.js';
import { NativeStateStore } from './native-state-store.js';

export const EXTENSION_KEY = 'yuzuki_story_state_addon';

const DEFAULT_SETTINGS = Object.freeze({
  memorySync: true,
  contentRevision: 2,
  promptOverrides: {},
  nativeStates: {},
});

const PHONE_RETRY_DELAYS = Object.freeze([600, 1400, 3000, 6000, 12000, 24000]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export class ContentAddonRuntime {
  constructor(onStatus = () => {}) {
    this.onStatus = onStatus;
    this.context = null;
    this.settings = { ...DEFAULT_SETTINGS };
    this.registry = null;
    this.memorySnapshot = readMemorySnapshot(null);
    this.active = false;
    this.listeners = [];
    this.windowListeners = [];
    this.pendingTimers = new Set();
    this.phoneRetryTimer = null;
    this.phoneRetryIndex = 0;
    this.syncChain = Promise.resolve();
    this.stateStore = new NativeStateStore({
      getContext: () => this.getContext(),
      getSettings: () => this.settings,
      saveSettings: () => this.persistSettings(),
      getRegistry: () => this.registry,
    });
    this.generation = new GenerationService({
      getContext: () => this.getContext(),
      getItem: (toolId) => this.stateStore.getItem(toolId),
      saveState: (toolId, state) => this.stateStore.update(toolId, state),
      getMemorySnapshot: () => this.memorySnapshot,
      getPromptOverride: (toolId) => this.getPrompt(toolId),
    });
    this.status = {
      active: false,
      phoneReady: false,
      memoryReady: false,
      storageReady: false,
      chatKey: '',
      lastSync: '',
      message: '尚未启动',
    };
  }

  getContext() {
    const context = globalThis.SillyTavern?.getContext?.();
    if (!context) throw new Error('未找到 SillyTavern.getContext。');
    return context;
  }

  persistSettings() {
    if (!this.context?.extensionSettings) return;
    this.context.extensionSettings[EXTENSION_KEY] = this.settings;
    this.context.saveSettingsDebounced?.();
  }

  async loadContent() {
    if (!this.registry) this.registry = await loadContentRegistry();
    return cloneContentRegistry(this.registry);
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
    const item = this.registry?.items?.find((candidate) => candidate.id === toolId);
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
    if (!GENERATION_TOOLS.some((tool) => tool.id === toolId)) throw new Error('未知的生成栏目。');
    const prompt = String(value || '').replace(/\u0000/g, '').trim();
    if (!prompt) throw new Error('提示词不能为空；如需恢复，请使用“恢复默认”。');
    if (prompt.length > 32000) throw new Error('提示词不能超过 32000 个字符。');
    this.settings.promptOverrides = { ...(this.settings.promptOverrides || {}), [toolId]: prompt };
    this.persistSettings();
    return prompt;
  }

  resetPrompt(toolId) {
    const next = { ...(this.settings.promptOverrides || {}) };
    delete next[toolId];
    this.settings.promptOverrides = next;
    this.persistSettings();
    return this.getDefaultPrompt(toolId);
  }

  resetAllPrompts() {
    this.settings.promptOverrides = {};
    this.persistSettings();
  }

  getSuggestedTargets() {
    return this.generation.getSuggestedTargets();
  }

  generateTool(toolId, options = {}) {
    return this.generation.generate(toolId, options);
  }

  updateToolState(toolId, state) {
    const updated = this.stateStore.update(toolId, state);
    if (!updated) throw new Error('保存到当前聊天失败。');
    return updated;
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
    this.bindContextEvent(events.APP_READY, () => this.scheduleRefresh('app-ready', 0));
    this.bindContextEvent(events.CHAT_CHANGED, () => this.scheduleRefresh('chat-changed', 120));
    this.bindContextEvent(events.MESSAGE_RECEIVED, () => this.scheduleRefresh('message-received', 220));
    this.bindWindowEvent('yzm-memory-state-updated', () => this.scheduleRefresh('memory-updated', 80));
    this.bindWindowEvent('yzm-memory-session-ready', () => this.scheduleRefresh('memory-session-ready', 80));
  }

  setTimer(callback, delay) {
    const timer = globalThis.setTimeout?.(() => {
      this.pendingTimers.delete(timer);
      callback();
    }, delay);
    if (timer !== undefined && timer !== null) this.pendingTimers.add(timer);
    return timer;
  }

  async start() {
    if (this.active) return this.getStatus();
    this.context = this.getContext();
    const stored = this.context.extensionSettings?.[EXTENSION_KEY];
    this.settings = { ...DEFAULT_SETTINGS, ...(isPlainObject(stored) ? stored : {}) };
    this.settings.promptOverrides = isPlainObject(this.settings.promptOverrides) ? { ...this.settings.promptOverrides } : {};
    this.settings.nativeStates = isPlainObject(this.settings.nativeStates) ? this.settings.nativeStates : {};
    this.settings.contentRevision = 2;
    this.persistSettings();
    this.active = true;
    this.bindEvents();
    await this.loadContent();
    this.setStatus({ active: true, storageReady: true, message: '原生 App 数据层已就绪，正在连接柚月手机与记忆插件…' });
    await this.refreshMemory('startup');
    this.schedulePhoneCheck();
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
    for (const timer of this.pendingTimers) globalThis.clearTimeout?.(timer);
    this.pendingTimers.clear();
    this.phoneRetryTimer = null;
    this.active = false;
    this.setStatus({ active: false, message: '扩展已停用' });
  }

  schedulePhoneCheck() {
    if (!this.active) return;
    const ready = Boolean(globalThis.VirtualPhone?.home?.phoneShell?.setContent);
    if (ready) {
      this.phoneRetryIndex = 0;
      this.phoneRetryTimer = null;
      this.setStatus({ phoneReady: true, message: this.memorySnapshot.available ? '扩展桌面 App 与柚月记忆均已连接。' : '扩展桌面 App 已就绪，等待柚月记忆插件。' });
      return;
    }
    if (this.phoneRetryIndex >= PHONE_RETRY_DELAYS.length) {
      this.setStatus({ phoneReady: false, message: '尚未检测到柚月手机；扩展会在下次打开手机时继续接入。' });
      return;
    }
    if (this.phoneRetryTimer) return;
    const delay = PHONE_RETRY_DELAYS[this.phoneRetryIndex];
    this.phoneRetryIndex += 1;
    this.phoneRetryTimer = this.setTimer(() => {
      this.phoneRetryTimer = null;
      this.schedulePhoneCheck();
    }, delay);
  }

  scheduleRefresh(reason, delay = 0) {
    if (!this.active) return;
    this.setTimer(() => this.refreshMemory(reason).catch((error) => this.handleError(error)), delay);
  }

  handleError(error) {
    console.error('[柚月剧情工坊]', error);
    this.setStatus({ message: `操作失败：${error.message}` });
  }

  refreshMemory(reason = 'manual') {
    this.syncChain = this.syncChain.then(async () => {
      if (!this.active) return this.getStatus();
      this.memorySnapshot = readMemorySnapshot(globalThis.YuzukiMemory);
      const timestamp = new Date().toLocaleString('zh-CN', { hour12: false });
      const phoneReady = Boolean(globalThis.VirtualPhone?.home?.phoneShell?.setContent);
      this.setStatus({
        phoneReady,
        memoryReady: hasMemoryRuntime(globalThis.YuzukiMemory),
        storageReady: true,
        chatKey: this.stateStore.getChatKey(),
        lastSync: this.memorySnapshot.available ? timestamp : this.status.lastSync,
        message: this.memorySnapshot.available
          ? `已只读刷新当前聊天记忆（${reason}）。`
          : '原生 App 数据层已就绪，正在等待柚月记忆插件。',
      });
      if (!phoneReady) this.schedulePhoneCheck();
      return this.getStatus();
    }).catch((error) => {
      this.handleError(error);
      return this.getStatus();
    });
    return this.syncChain;
  }
}
