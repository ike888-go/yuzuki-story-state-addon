const MAX_CHAT_STATES = 80;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function safeKey(value) {
  return String(value ?? '').replace(/\u0000/g, '').trim().slice(0, 300);
}

export function resolveNativeChatKey(context = {}, memoryNamespace = globalThis.YuzukiMemory) {
  const memorySession = safeKey(memoryNamespace?.Storage?.getCurrentSessionId?.());
  if (memorySession) return `memory:${memorySession}`;
  const direct = safeKey(context?.chatId || context?.chat_id || context?.getCurrentChatId?.());
  if (direct) return `chat:${direct}`;
  const groupId = safeKey(context?.groupId ?? context?.group_id);
  const characterId = safeKey(context?.characterId ?? context?.character_id);
  const characterName = safeKey(context?.name2 || 'unknown');
  return `scope:${groupId || 'solo'}:${characterId || characterName}`;
}

export class NativeStateStore {
  constructor({ getContext, getSettings, saveSettings, getRegistry }) {
    this.getContext = getContext;
    this.getSettings = getSettings;
    this.saveSettings = saveSettings;
    this.getRegistry = getRegistry;
  }

  getChatKey() {
    return resolveNativeChatKey(this.getContext(), globalThis.YuzukiMemory);
  }

  getDefinition(toolId) {
    return this.getRegistry()?.items?.find((item) => String(item.id) === String(toolId)) || null;
  }

  getBucket(create = false) {
    const settings = this.getSettings();
    if (!isPlainObject(settings.nativeStates)) settings.nativeStates = {};
    const key = this.getChatKey();
    let bucket = settings.nativeStates[key];
    if (!isPlainObject(bucket) && create) {
      bucket = { updatedAt: Date.now(), states: {} };
      settings.nativeStates[key] = bucket;
    }
    return { key, bucket: isPlainObject(bucket) ? bucket : null };
  }

  getItem(toolId) {
    const definition = this.getDefinition(toolId);
    if (!definition) return null;
    const { bucket } = this.getBucket(false);
    const saved = isPlainObject(bucket?.states?.[toolId]) ? bucket.states[toolId] : null;
    return {
      ...clone(definition),
      state: clone(saved || definition.initialState),
      storage: 'native-extension-settings',
      chatKey: this.getChatKey(),
    };
  }

  update(toolId, state) {
    const definition = this.getDefinition(toolId);
    if (!definition || !isPlainObject(state)) return null;
    const settings = this.getSettings();
    const { key, bucket } = this.getBucket(true);
    bucket.states = isPlainObject(bucket.states) ? bucket.states : {};
    bucket.states[toolId] = clone(state);
    bucket.updatedAt = Date.now();
    this.prune(settings.nativeStates, key);
    this.saveSettings();
    return this.getItem(toolId);
  }

  prune(nativeStates, currentKey) {
    const entries = Object.entries(nativeStates || {});
    if (entries.length <= MAX_CHAT_STATES) return;
    entries
      .filter(([key]) => key !== currentKey)
      .sort((a, b) => Number(a[1]?.updatedAt || 0) - Number(b[1]?.updatedAt || 0))
      .slice(0, Math.max(0, entries.length - MAX_CHAT_STATES))
      .forEach(([key]) => delete nativeStates[key]);
  }
}
