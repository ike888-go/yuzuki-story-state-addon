import {
  PATCH_TAG,
  applyPatch,
  buildMemoryProjection,
  clone,
  compactStateForPrompt,
  createDefaultRoot,
  extractStateBlocks,
  makeId,
  normalizeRoot,
  normalizeState,
  rebuildState,
} from './state-model.js';
import { importLegacyDatabase } from './legacy-import.js';

export const EXTENSION_KEY = 'yuzuki_story_state_addon';
export const PROMPT_KEY = `${EXTENSION_KEY}_state`;

const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  promptEnabled: true,
  phoneTile: true,
  floatingButton: true,
  hideStateBlocks: true,
});

function messageKey(index, message) {
  const swipeId = Number.isInteger(message?.swipe_id) ? message.swipe_id : 0;
  return `${index}:${swipeId}`;
}

function isAssistant(message) {
  return message && message.is_user !== true;
}

function selectedText(message) {
  const swipeId = Number.isInteger(message?.swipe_id) ? message.swipe_id : 0;
  return String(message?.swipes?.[swipeId] ?? message?.mes ?? '');
}

function messageMarkers(message, create = false) {
  if (!message || typeof message !== 'object') return null;
  if (!message.extra || typeof message.extra !== 'object') {
    if (!create) return null;
    message.extra = {};
  }
  if (!message.extra[EXTENSION_KEY] || typeof message.extra[EXTENSION_KEY] !== 'object') {
    if (!create) return null;
    message.extra[EXTENSION_KEY] = { swipes: {} };
  }
  const marker = message.extra[EXTENSION_KEY];
  if (!marker.swipes || typeof marker.swipes !== 'object') marker.swipes = {};
  return marker.swipes;
}

function findMessageIndex(context, hint) {
  if (Number.isInteger(hint) && context.chat[hint]) return hint;
  if (Number.isInteger(Number(hint)) && context.chat[Number(hint)]) return Number(hint);
  return context.chat.length - 1;
}

function promptText(state) {
  return [
    '[柚月剧情状态增量包]',
    '你需要在正常剧情回复的最末尾附加一次状态补丁；它会在显示前被扩展隐藏并保存，不需要额外调用 API。',
    `严格格式：<${PATCH_TAG}>{"schemaVersion":1,"set":{},"upsert":{},"append":{},"remove":{}}</${PATCH_TAG}>`,
    '只写本轮实际改变的字段。set 仅允许 protagonist/scene/global/adult/misc 下的路径；upsert 可含 characters/inventory/quests/skills/checks 数组；append 可含 chronicles/milestones/diaries/investigations 数组；remove 使用各分组的 id 数组。',
    'JSON 必须合法，不得在标签内写注释、Markdown 或省略号。大调查由用户手动触发时再生成，不要每轮自动调查。',
    '当前状态（用于增量判断）：',
    JSON.stringify(compactStateForPrompt(state)),
  ].join('\n');
}

export class StoryStateRuntime {
  constructor(onChange = () => {}) {
    this.onChange = onChange;
    this.context = null;
    this.settings = { ...DEFAULT_SETTINGS };
    this.root = createDefaultRoot();
    this.listeners = [];
    this.saveChain = Promise.resolve();
    this.active = false;
  }

  getContext() {
    const context = globalThis.SillyTavern?.getContext?.();
    if (!context) throw new Error('未找到 SillyTavern.getContext，扩展无法启动。');
    return context;
  }

  async start() {
    if (this.active) return;
    this.context = this.getContext();
    const stored = this.context.extensionSettings[EXTENSION_KEY];
    this.settings = { ...DEFAULT_SETTINGS, ...(stored && typeof stored === 'object' ? stored : {}) };
    this.context.extensionSettings[EXTENSION_KEY] = this.settings;
    this.context.saveSettingsDebounced?.();
    this.active = true;
    this.bindEvents();
    await this.reload('start');
  }

  stop() {
    if (!this.active) return;
    for (const [event, handler] of this.listeners) this.context?.eventSource?.removeListener?.(event, handler);
    this.listeners = [];
    this.context?.setExtensionPrompt?.(PROMPT_KEY, '', 1, 0, false, 0);
    this.active = false;
  }

  bind(event, handler) {
    if (!event || !this.context?.eventSource?.on) return;
    this.context.eventSource.on(event, handler);
    this.listeners.push([event, handler]);
  }

  bindEvents() {
    const events = this.context.eventTypes || this.context.event_types || {};
    this.bind(events.MESSAGE_RECEIVED, (index) => this.processMessage(index, 'received'));
    this.bind(events.MESSAGE_EDITED, (index) => this.processMessage(index, 'edited'));
    this.bind(events.MESSAGE_SWIPED, (index) => this.processMessage(index, 'swiped'));
    this.bind(events.MESSAGE_SWIPE_DELETED, (detail) => this.handleSwipeDeleted(detail));
    this.bind(events.MESSAGE_DELETED, () => this.reload('deleted', true));
    this.bind(events.CHAT_CHANGED, () => this.reload('chat-changed', true));
  }

  readRoot() {
    const raw = this.context?.chatMetadata?.[EXTENSION_KEY];
    this.root = normalizeRoot(raw);
    return this.root;
  }

  async reload(reason = 'reload', prune = false) {
    if (!this.active) return;
    this.context = this.getContext();
    this.readRoot();
    if (prune) this.pruneMessageRecords();
    this.root = rebuildState(this.root, this.context.chat || []);
    await this.persist(reason);
  }

  pruneMessageRecords() {
    const chat = this.context.chat || [];
    const recordsById = new Map(Object.values(this.root.messagePatches)
      .filter((record) => record?.id)
      .map((record) => [record.id, record]));
    const previous = this.root.messagePatches;
    const next = {};
    chat.forEach((message, index) => {
      if (!isAssistant(message)) return;
      const swipeCount = Array.isArray(message.swipes) ? message.swipes.length : 1;
      const markers = messageMarkers(message);
      for (let swipeId = 0; swipeId < swipeCount; swipeId += 1) {
        const key = `${index}:${swipeId}`;
        const marked = markers?.[swipeId] ? recordsById.get(markers[swipeId]) : null;
        const record = marked || previous[key];
        if (record) next[key] = { ...record, messageIndex: index, swipeId };
      }
    });
    this.root.messagePatches = next;
  }

  async handleSwipeDeleted(detail) {
    const message = this.context?.chat?.[detail?.messageId];
    const deleted = Number(detail?.swipeId);
    const markers = messageMarkers(message);
    if (markers && Number.isInteger(deleted)) {
      const shifted = {};
      for (const [rawIndex, recordId] of Object.entries(markers)) {
        const index = Number(rawIndex);
        if (!Number.isInteger(index) || index === deleted) continue;
        shifted[index > deleted ? index - 1 : index] = recordId;
      }
      message.extra[EXTENSION_KEY].swipes = shifted;
    }
    await this.reload('swipe-deleted', true);
  }

  async processMessage(hint, reason) {
    if (!this.active || !this.settings.enabled) return;
    this.context = this.getContext();
    const index = findMessageIndex(this.context, hint);
    const message = this.context.chat[index];
    if (!isAssistant(message)) return;
    const key = messageKey(index, message);
    const text = selectedText(message);
    let parsed;
    try {
      parsed = extractStateBlocks(text);
    } catch (error) {
      this.root.lastError = `第 ${index} 条消息的状态补丁解析失败：${error.message}`;
      await this.persist('parse-error');
      return;
    }

    if (parsed.patches.length) {
      const recordId = this.root.messagePatches[key]?.id || makeId('message_patch');
      this.root.messagePatches[key] = {
        id: recordId,
        messageIndex: index,
        swipeId: Number.isInteger(message.swipe_id) ? message.swipe_id : 0,
        patches: parsed.patches,
        capturedAt: new Date().toISOString(),
      };
      messageMarkers(message, true)[Number.isInteger(message.swipe_id) ? message.swipe_id : 0] = recordId;
      this.root.lastError = null;
      if (this.settings.hideStateBlocks && parsed.cleanedText !== text) await this.scrubMessage(index, message, parsed.cleanedText);
    } else if (reason === 'edited' && this.root.messagePatches[key]) {
      delete this.root.messagePatches[key];
      const markers = messageMarkers(message);
      if (markers) delete markers[Number.isInteger(message.swipe_id) ? message.swipe_id : 0];
    }

    this.root.revision += 1;
    this.root = rebuildState(this.root, this.context.chat || []);
    await this.persist(reason);
  }

  async scrubMessage(index, message, cleanedText) {
    const swipeId = Number.isInteger(message.swipe_id) ? message.swipe_id : 0;
    message.mes = cleanedText;
    if (Array.isArray(message.swipes) && message.swipes[swipeId] !== undefined) message.swipes[swipeId] = cleanedText;
    try {
      await this.context.updateMessageBlock?.(index, message, { rerenderMessage: true });
    } catch (error) {
      console.warn('[柚月剧情状态] 消息重绘失败，状态仍已保存。', error);
    }
  }

  updatePrompt() {
    if (!this.context?.setExtensionPrompt) return;
    const enabled = this.settings.enabled && this.settings.promptEnabled;
    this.context.setExtensionPrompt(PROMPT_KEY, enabled ? promptText(this.root.state) : '', 1, 0, false, 0);
  }

  persist(reason = 'save') {
    this.saveChain = this.saveChain.then(async () => {
      if (!this.active || !this.context?.chatMetadata) return;
      this.context.chatMetadata[EXTENSION_KEY] = clone(this.root);
      this.updatePrompt();
      await this.context.saveChat?.();
      const detail = { reason, state: clone(this.root.state), memory: buildMemoryProjection(this.root.state) };
      globalThis.dispatchEvent?.(new CustomEvent('yuzuki-story-state:updated', { detail }));
      this.onChange(detail);
    }).catch((error) => {
      console.error('[柚月剧情状态] 保存失败', error);
    });
    return this.saveChain;
  }

  getState() {
    return clone(this.root.state);
  }

  getMemoryProjection() {
    return buildMemoryProjection(this.root.state);
  }

  async applyManualPatch(patch, source = 'manual') {
    applyPatch(this.root.state, patch);
    this.root.manualPatches.push({ id: makeId(source), source, enabled: true, createdAt: new Date().toISOString(), patch });
    this.root.manualPatches = this.root.manualPatches.slice(-300);
    this.root.revision += 1;
    this.root = rebuildState(this.root, this.context.chat || []);
    await this.persist(source);
    return this.getState();
  }

  async importLegacy(input) {
    const imported = importLegacyDatabase(input);
    this.root.baseState = normalizeState(imported);
    this.root.manualPatches = [];
    this.root.revision += 1;
    this.root = rebuildState(this.root, this.context.chat || []);
    await this.persist('legacy-import');
    return this.getState();
  }

  exportData() {
    return {
      format: 'yuzuki-story-state-addon',
      version: 1,
      exportedAt: new Date().toISOString(),
      chatId: this.context?.chatId ?? null,
      root: clone(this.root),
    };
  }

  async importData(input) {
    if (input?.format !== 'yuzuki-story-state-addon' || !input.root) throw new Error('不是柚月剧情状态增量包的导出文件。');
    this.root = normalizeRoot(input.root);
    this.root.revision += 1;
    this.root = rebuildState(this.root, this.context.chat || []);
    await this.persist('addon-import');
  }

  async reset() {
    this.root = createDefaultRoot();
    await this.persist('reset');
  }

  async setSetting(key, value) {
    if (!(key in DEFAULT_SETTINGS)) return;
    this.settings[key] = Boolean(value);
    this.context.extensionSettings[EXTENSION_KEY] = this.settings;
    this.context.saveSettingsDebounced?.();
    this.updatePrompt();
    this.onChange({ reason: 'settings', state: this.getState(), memory: this.getMemoryProjection() });
  }
}
