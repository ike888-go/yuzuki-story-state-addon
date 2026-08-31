export const CONTENT_TYPE = 'yuzuki_native_story_app';
export const CONTENT_VERSION = 1;

const CONTENT_URL = new URL('../packs/yuzuki-native-app-content.json', import.meta.url);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function validateContentRegistry(input) {
  if (!isPlainObject(input)) throw new Error('剧情工坊内容定义必须是 JSON 对象。');
  if (input.type !== CONTENT_TYPE) throw new Error(`不支持的内容定义类型：${String(input.type || '空')}`);
  if (Number(input.version) !== CONTENT_VERSION) throw new Error(`不支持的内容定义版本：${String(input.version || '空')}`);
  if (!Array.isArray(input.items) || input.items.length !== 4) throw new Error('剧情工坊必须包含四个原生栏目。');

  const ids = new Set();
  const keys = new Set();
  for (const [index, item] of input.items.entries()) {
    if (!isPlainObject(item)) throw new Error(`第 ${index + 1} 个栏目不是对象。`);
    const id = String(item.id || '').trim();
    const key = String(item.key || '').trim();
    if (!id || !key || !String(item.name || '').trim()) throw new Error(`第 ${index + 1} 个栏目缺少 id、key 或 name。`);
    if (ids.has(id) || keys.has(key)) throw new Error(`栏目标识重复：${id || key}`);
    if (!isPlainObject(item.initialState)) throw new Error(`栏目 ${id} 的 initialState 必须是对象。`);
    if (!String(item.promptTemplate || '').trim()) throw new Error(`栏目 ${id} 缺少生成提示词。`);
    ids.add(id);
    keys.add(key);
  }
  return clone(input);
}

export async function loadContentRegistry(fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') throw new Error('当前环境不支持读取剧情工坊内容定义。');
  const response = await fetchImpl(CONTENT_URL.href, { cache: 'no-cache' });
  if (!response?.ok) throw new Error(`读取剧情工坊内容定义失败：HTTP ${response?.status || 'unknown'}`);
  return validateContentRegistry(await response.json());
}

export function cloneContentRegistry(registry) {
  return clone(validateContentRegistry(registry));
}
