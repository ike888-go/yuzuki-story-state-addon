export const STATE_SCHEMA_VERSION = 1;
export const PATCH_TAG = 'YUZUKI_STATE_PATCH';

const ENTITY_GROUPS = Object.freeze(['characters', 'inventory', 'quests', 'skills', 'checks']);
const LOG_GROUPS = Object.freeze(['chronicles', 'milestones', 'diaries', 'investigations']);
const SET_ROOTS = new Set(['protagonist', 'scene', 'global', 'adult', 'misc']);
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

export function makeId(prefix = 'id') {
  const token = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${token}`;
}

export function createDefaultState() {
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    revision: 0,
    updatedAt: null,
    protagonist: {},
    scene: {},
    global: {},
    characters: {},
    inventory: {},
    quests: {},
    skills: {},
    checks: {},
    chronicles: [],
    milestones: [],
    diaries: [],
    investigations: [],
    adult: {},
    misc: {},
  };
}

export function createDefaultRoot() {
  const baseState = createDefaultState();
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    revision: 0,
    baseState,
    messagePatches: {},
    manualPatches: [],
    state: clone(baseState),
    lastError: null,
  };
}

function sanitizeKey(key) {
  const text = String(key || '').trim();
  if (!text || FORBIDDEN_KEYS.has(text)) return '';
  return text.slice(0, 120);
}

export function sanitizeJson(value, depth = 0) {
  if (depth > 8) return null;
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return value.slice(0, 8000);
  if (Array.isArray(value)) return value.slice(0, 500).map((item) => sanitizeJson(item, depth + 1));
  if (typeof value !== 'object') return null;

  const out = {};
  for (const [rawKey, rawValue] of Object.entries(value).slice(0, 300)) {
    const key = sanitizeKey(rawKey);
    if (!key) continue;
    out[key] = sanitizeJson(rawValue, depth + 1);
  }
  return out;
}

function normalizeEntityMap(value) {
  const out = {};
  if (Array.isArray(value)) {
    for (const item of value) {
      if (!item || typeof item !== 'object') continue;
      const safe = sanitizeJson(item);
      const id = sanitizeKey(safe.id || safe.key || safe.name || safe.title || makeId('entity'));
      if (id) out[id] = { ...safe, id };
    }
    return out;
  }
  if (!value || typeof value !== 'object') return out;
  for (const [rawId, item] of Object.entries(value)) {
    const id = sanitizeKey(rawId);
    if (!id || !item || typeof item !== 'object') continue;
    out[id] = { ...sanitizeJson(item), id };
  }
  return out;
}

function normalizeLog(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(-500).map((item, index) => {
    const safe = item && typeof item === 'object' ? sanitizeJson(item) : { summary: String(item ?? '') };
    return { ...safe, id: sanitizeKey(safe.id || `entry_${index}_${Date.now()}`) };
  });
}

export function normalizeState(value) {
  const defaults = createDefaultState();
  const source = value && typeof value === 'object' ? sanitizeJson(value) : {};
  for (const root of SET_ROOTS) defaults[root] = source[root] && typeof source[root] === 'object' ? source[root] : {};
  for (const group of ENTITY_GROUPS) defaults[group] = normalizeEntityMap(source[group]);
  for (const group of LOG_GROUPS) defaults[group] = normalizeLog(source[group]);
  defaults.revision = Number.isInteger(source.revision) ? Math.max(0, source.revision) : 0;
  defaults.updatedAt = typeof source.updatedAt === 'string' ? source.updatedAt : null;
  return defaults;
}

export function normalizeRoot(value) {
  const defaults = createDefaultRoot();
  if (!value || typeof value !== 'object') return defaults;
  defaults.revision = Number.isInteger(value.revision) ? Math.max(0, value.revision) : 0;
  defaults.baseState = normalizeState(value.baseState || value.state);
  defaults.state = normalizeState(value.state || value.baseState);
  defaults.messagePatches = sanitizeJson(value.messagePatches || {});
  defaults.manualPatches = Array.isArray(value.manualPatches)
    ? value.manualPatches.slice(-300).map((record) => sanitizeJson(record))
    : [];
  defaults.lastError = typeof value.lastError === 'string' ? value.lastError.slice(0, 1000) : null;
  return defaults;
}

function setPath(target, path, value) {
  const rawParts = String(path || '').split('.');
  const parts = rawParts.map(sanitizeKey);
  if (parts.some((part) => !part)) return;
  if (parts.length < 2 || !SET_ROOTS.has(parts[0]) || parts.length > 6) return;
  let cursor = target;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index];
    if (!cursor[part] || typeof cursor[part] !== 'object' || Array.isArray(cursor[part])) cursor[part] = {};
    cursor = cursor[part];
  }
  cursor[parts.at(-1)] = sanitizeJson(value);
}

function normalizePatch(patch) {
  if (!patch || typeof patch !== 'object') throw new Error('状态补丁必须是 JSON 对象');
  if (patch.schemaVersion !== undefined && Number(patch.schemaVersion) !== STATE_SCHEMA_VERSION) {
    throw new Error(`不支持的状态补丁版本: ${patch.schemaVersion}`);
  }
  return sanitizeJson(patch);
}

function entityId(item, group) {
  return sanitizeKey(item?.id || item?.key || item?.name || item?.title || makeId(group.slice(0, -1) || 'entity'));
}

export function applyPatch(inputState, rawPatch) {
  const state = normalizeState(inputState);
  const patch = normalizePatch(rawPatch);

  if (patch.set && typeof patch.set === 'object') {
    for (const [path, value] of Object.entries(patch.set)) setPath(state, path, value);
  }

  if (patch.upsert && typeof patch.upsert === 'object') {
    for (const group of ENTITY_GROUPS) {
      const items = Array.isArray(patch.upsert[group]) ? patch.upsert[group] : [];
      for (const rawItem of items) {
        if (!rawItem || typeof rawItem !== 'object') continue;
        const item = sanitizeJson(rawItem);
        const id = entityId(item, group);
        if (!id) continue;
        state[group][id] = { ...(state[group][id] || {}), ...item, id };
      }
    }
  }

  if (patch.append && typeof patch.append === 'object') {
    for (const group of LOG_GROUPS) {
      const items = Array.isArray(patch.append[group]) ? patch.append[group] : [];
      for (const rawItem of items) {
        const item = rawItem && typeof rawItem === 'object' ? sanitizeJson(rawItem) : { summary: String(rawItem ?? '') };
        const id = entityId(item, group);
        if (!id) continue;
        const existing = state[group].findIndex((entry) => entry.id === id);
        const next = { ...(existing >= 0 ? state[group][existing] : {}), ...item, id };
        if (existing >= 0) state[group][existing] = next;
        else state[group].push(next);
      }
      state[group] = state[group].slice(-500);
    }
  }

  if (patch.remove && typeof patch.remove === 'object') {
    for (const group of ENTITY_GROUPS) {
      const ids = Array.isArray(patch.remove[group]) ? patch.remove[group].map(String) : [];
      for (const id of ids) delete state[group][id];
    }
    for (const group of LOG_GROUPS) {
      const ids = new Set(Array.isArray(patch.remove[group]) ? patch.remove[group].map(String) : []);
      if (ids.size) state[group] = state[group].filter((item) => !ids.has(String(item.id)));
    }
  }

  return state;
}

export function rebuildState(rootValue, chat = []) {
  const root = normalizeRoot(rootValue);
  let state = normalizeState(root.baseState);
  const selectedKeys = [];

  for (let index = 0; index < chat.length; index += 1) {
    const message = chat[index] || {};
    if (message.is_user) continue;
    const swipeId = Number.isInteger(message.swipe_id) ? message.swipe_id : 0;
    selectedKeys.push(`${index}:${swipeId}`);
  }

  for (const key of selectedKeys) {
    const record = root.messagePatches[key];
    const patches = Array.isArray(record?.patches) ? record.patches : [];
    for (const patch of patches) state = applyPatch(state, patch);
  }

  for (const record of root.manualPatches) {
    if (!record || record.enabled === false) continue;
    state = applyPatch(state, record.patch);
  }

  state.revision = root.revision;
  state.updatedAt = new Date().toISOString();
  root.state = state;
  return root;
}

export function extractStateBlocks(text) {
  const source = String(text || '');
  const pattern = new RegExp(`<${PATCH_TAG}\\s*>([\\s\\S]*?)<\\/${PATCH_TAG}\\s*>`, 'gi');
  const patches = [];
  let match;
  while ((match = pattern.exec(source)) !== null) {
    let payload = match[1].trim();
    payload = payload.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    patches.push(normalizePatch(JSON.parse(payload)));
  }
  return {
    patches,
    cleanedText: source.replace(pattern, '').replace(/\n{3,}/g, '\n\n').trim(),
  };
}

function trimObjectMap(map, limit) {
  return Object.fromEntries(Object.entries(map || {}).slice(-limit));
}

export function compactStateForPrompt(inputState) {
  const state = normalizeState(inputState);
  return {
    protagonist: state.protagonist,
    scene: state.scene,
    global: state.global,
    characters: trimObjectMap(state.characters, 30),
    inventory: trimObjectMap(state.inventory, 40),
    quests: trimObjectMap(state.quests, 30),
    skills: trimObjectMap(state.skills, 30),
    checks: trimObjectMap(state.checks, 20),
    chronicles: state.chronicles.slice(-12),
    milestones: state.milestones.slice(-12),
    adult: state.adult,
  };
}

function summarizeEntry(entry) {
  return String(entry?.summary || entry?.overview || entry?.content || entry?.title || '').trim();
}

export function buildMemoryProjection(inputState) {
  const state = normalizeState(inputState);
  const recent = state.chronicles.slice(-8).map(summarizeEntry).filter(Boolean).join('；') || '暂无已记录纪要';
  const openQuests = Object.values(state.quests)
    .filter((quest) => !['完成', '已完成', 'failed', 'done', 'cancelled', '取消'].includes(String(quest.status || '').toLowerCase()))
    .map((quest) => quest.title || quest.name || quest.id)
    .filter(Boolean)
    .slice(0, 12)
    .join('；') || '暂无明确未完事项';
  const impressions = Object.values(state.characters)
    .slice(0, 20)
    .map((character) => `${character.name || character.id}：${character.attitude || character.relationship || character.identity || '暂无稳定印象'}`)
    .join('\n');
  const relations = state.milestones.slice(-8).map(summarizeEntry).filter(Boolean).join('；') || '暂无明确关系里程碑';

  return [
    '<YUZUKI_STORY_MEMORY>',
    `最近事件：${recent}`,
    `未解决事项：${openQuests}`,
    `角色印象：\n${impressions || '暂无人物档案'}`,
    `关系变化：${relations}`,
    '</YUZUKI_STORY_MEMORY>',
  ].join('\n');
}
