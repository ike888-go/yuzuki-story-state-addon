const TABLES = Object.freeze({
  plot_summary: '剧情摘要',
  character_profile: '角色档案',
  item_tracking: '物品追踪',
  world_setting: '世界设定',
});

function text(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch (_error) {
      return '';
    }
  }
  return String(value).trim();
}

function truncate(value, limit) {
  const source = text(value);
  return source.length > limit ? `${source.slice(0, Math.max(0, limit - 1))}…` : source;
}

function formatRecord(record, index) {
  const values = record?.values && typeof record.values === 'object' ? record.values : {};
  const fields = Object.entries(values)
    .map(([key, value]) => [text(key), text(value)])
    .filter(([key, value]) => key && value)
    .map(([key, value]) => `${key}：${value}`);
  return fields.length ? `${index + 1}. ${fields.join('｜')}` : '';
}

function formatTable(state, tableId, limit = 3600) {
  const records = Array.isArray(state?.records?.[tableId]) ? state.records[tableId] : [];
  return truncate(records.map(formatRecord).filter(Boolean).join('\n'), limit);
}

function countRecords(state) {
  return Object.values(state?.records || {}).reduce((total, records) => (
    total + (Array.isArray(records) ? records.length : 0)
  ), 0);
}

export function hasMemoryRuntime(namespace = globalThis.YuzukiMemory) {
  return Boolean(namespace?.Storage?.loadState)
    && Boolean(namespace?.VariableInjector?.createDefaultState || namespace?.MemoryTagParser?.createDefaultState);
}

export function readMemorySnapshot(namespace = globalThis.YuzukiMemory, now = new Date()) {
  if (!hasMemoryRuntime(namespace)) {
    return {
      available: false,
      state: {
        status: '等待柚月记忆插件',
        updatedAt: '',
        session: '',
        recordCount: 0,
        summary: '记忆插件加载后会自动刷新。',
        plot: '',
        characters: '',
        items: '',
        world: '',
      },
    };
  }

  const injector = namespace.VariableInjector || namespace.MemoryTagParser;
  const fallback = injector.createDefaultState();
  const session = text(namespace.Storage.getCurrentSessionId?.());
  const memoryState = namespace.Storage.loadState(fallback, session || undefined) || fallback;
  const summaryBuilder = namespace.VariableInjector?.buildSummaryText;
  const summary = typeof summaryBuilder === 'function' ? summaryBuilder(memoryState) : '';

  return {
    available: true,
    state: {
      status: '已连接 · 只读同步',
      updatedAt: now.toLocaleString('zh-CN', { hour12: false }),
      session,
      recordCount: countRecords(memoryState),
      summary: truncate(summary || formatTable(memoryState, 'memory_summary', 6000) || '暂无记忆总结。', 6000),
      plot: formatTable(memoryState, 'plot_summary') || '暂无剧情摘要。',
      characters: formatTable(memoryState, 'character_profile') || '暂无角色档案。',
      items: formatTable(memoryState, 'item_tracking') || '暂无物品记录。',
      world: formatTable(memoryState, 'world_setting') || '暂无世界设定。',
      tableLabels: Object.values(TABLES).join(' / '),
    },
  };
}
