function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function isMofoData(value) {
  return Boolean(value)
    && typeof value.getItems === 'function'
    && typeof value.createItem === 'function'
    && typeof value.updateItem === 'function';
}

export function resolveMofoData(host = globalThis) {
  const phone = host?.VirtualPhone || host?.window?.VirtualPhone;
  const candidates = [phone?.mofoApp?.mofoData, phone?.cachedMofoData];
  return candidates.find(isMofoData) || null;
}

function collisionKey(item) {
  return [String(item?.name || '').trim(), String(item?.tagName || '').trim()].filter(Boolean);
}

export function installMissingItems(mofoData, pack) {
  if (!isMofoData(mofoData)) {
    return { available: false, installed: [], existing: [], conflicts: [] };
  }

  const current = mofoData.getItems();
  const byId = new Map(current.map((item) => [String(item?.id || ''), item]));
  const occupied = new Map();
  current.forEach((item) => collisionKey(item).forEach((key) => occupied.set(key, item)));

  const result = { available: true, installed: [], existing: [], conflicts: [] };
  for (const definition of pack.items) {
    if (byId.has(definition.id)) {
      result.existing.push(definition.id);
      continue;
    }
    const collision = collisionKey(definition).map((key) => occupied.get(key)).find(Boolean);
    if (collision) {
      result.conflicts.push({ id: definition.id, existingId: String(collision.id || ''), name: definition.name });
      continue;
    }
    const created = mofoData.createItem(clone(definition));
    if (!created) throw new Error(`魔坊没有创建模板：${definition.name}`);
    result.installed.push(definition.id);
    byId.set(definition.id, created);
    collisionKey(created).forEach((key) => occupied.set(key, created));
  }
  return result;
}

export function upgradeManagedItems(mofoData, pack, itemIds = []) {
  if (!isMofoData(mofoData)) return [];
  const definitions = new Map((pack?.items || []).map((item) => [String(item?.id || ''), item]));
  const upgraded = [];
  for (const itemId of itemIds) {
    const definition = definitions.get(String(itemId));
    const current = mofoData.getItemById?.(itemId)
      || mofoData.getItems().find((item) => String(item?.id || '') === String(itemId));
    if (!definition || !current) continue;
    const nextState = Object.hasOwn(current.state || {}, 'orientation')
      && Object.hasOwn(current.state || {}, 'bodyData')
      ? current.state
      : {
          ...clone(definition.initialState || {}),
          target: current.state?.target || definition.initialState?.target || '',
          userNote: current.state?.profile
            ? `旧版档案摘要：${String(current.state.profile).slice(0, 800)}`
            : definition.initialState?.userNote || '',
          _legacyState: clone(current.state || {}),
        };
    const updated = mofoData.updateItem(itemId, {
      ...clone(definition),
      state: clone(nextState),
      lastUpdatedBy: 'yuzuki-addon-content-upgrade',
      updatedAt: Date.now(),
    });
    if (updated) upgraded.push(itemId);
  }
  return upgraded;
}

export function updateItemState(mofoData, itemId, state, source = 'yuzuki-addon') {
  if (!isMofoData(mofoData)) return null;
  const item = mofoData.getItemById?.(itemId)
    || mofoData.getItems().find((candidate) => String(candidate?.id || '') === String(itemId));
  if (!item) return null;
  return mofoData.updateItem(itemId, {
    state: clone(state),
    lastUpdatedBy: source,
    updatedAt: Date.now(),
  });
}
