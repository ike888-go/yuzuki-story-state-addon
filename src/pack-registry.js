export const PACK_TYPE = 'virtual_phone_mofo_templates';
export const PACK_VERSION = 1;
export const MEMORY_ITEM_ID = 'yssa_memory_snapshot';

const PACK_URL = new URL('../packs/yuzuki-mofo-content-pack.json', import.meta.url);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function validateImportPack(input) {
  if (!isPlainObject(input)) throw new Error('魔坊内容包必须是 JSON 对象。');
  if (input.type !== PACK_TYPE) throw new Error(`不支持的内容包类型：${String(input.type || '空')}`);
  if (Number(input.version) !== PACK_VERSION) throw new Error(`不支持的内容包版本：${String(input.version || '空')}`);
  if (!Array.isArray(input.items) || input.items.length === 0) throw new Error('魔坊内容包没有 items。');

  const ids = new Set();
  const tags = new Set();
  input.items.forEach((item, index) => {
    if (!isPlainObject(item)) throw new Error(`第 ${index + 1} 个模板不是对象。`);
    const id = String(item.id || '').trim();
    const name = String(item.name || '').trim();
    const tagName = String(item.tagName || '').trim();
    if (!id || !name || !tagName) throw new Error(`第 ${index + 1} 个模板缺少 id、name 或 tagName。`);
    if (ids.has(id)) throw new Error(`模板 id 重复：${id}`);
    if (tags.has(tagName)) throw new Error(`模板 tagName 重复：${tagName}`);
    const html = String(item.htmlTemplate || item['html模板'] || '').trim();
    if (!html) throw new Error(`模板 ${id} 缺少 HTML。`);
    if (/<(?:script|iframe)\b|\son[a-z]+\s*=|javascript:/i.test(html)) throw new Error(`模板 ${id} 包含不安全 HTML。`);
    if (!isPlainObject(item.initialState)) throw new Error(`模板 ${id} 的 initialState 必须是对象。`);
    ids.add(id);
    tags.add(tagName);
  });

  if (!ids.has(MEMORY_ITEM_ID)) throw new Error(`内容包缺少只读记忆模板 ${MEMORY_ITEM_ID}。`);
  return clone(input);
}

export async function loadImportPack(fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') throw new Error('当前环境不支持读取内置魔坊内容包。');
  const response = await fetchImpl(PACK_URL.href, { cache: 'no-cache' });
  if (!response?.ok) throw new Error(`读取内置魔坊内容包失败：HTTP ${response?.status || 'unknown'}`);
  return validateImportPack(await response.json());
}

export function clonePack(pack) {
  return clone(validateImportPack(pack));
}
