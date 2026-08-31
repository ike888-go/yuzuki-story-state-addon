import { createDefaultState, makeId, normalizeState, sanitizeJson } from './state-model.js';

function tableList(input) {
  if (!input || typeof input !== 'object') return [];
  const candidates = [input, input.currentJsonTableData_ACU, input.tableData, input.data].filter(Boolean);
  for (const candidate of candidates) {
    const sheets = Object.entries(candidate)
      .filter(([key, value]) => key.startsWith('sheet_') && value && Array.isArray(value.content))
      .map(([key, value]) => ({ key, name: String(value.name || key), content: value.content }));
    if (sheets.length) return sheets;
  }
  return [];
}

function rows(sheet) {
  const [headers = [], ...dataRows] = sheet.content;
  return dataRows
    .filter((row) => Array.isArray(row) && row.some((cell) => cell !== null && String(cell).trim() !== ''))
    .map((row) => Object.fromEntries(headers.map((header, index) => [String(header || `列${index}`), row[index] ?? ''])));
}

function pick(row, names, fallback = '') {
  for (const name of names) {
    if (row[name] !== undefined && String(row[name]).trim() !== '') return row[name];
  }
  return fallback;
}

function stableId(row, prefix, names) {
  return String(pick(row, ['row_id', 'ID', 'id', '编码索引', ...names], makeId(prefix))).trim();
}

function addCharacters(state, sheet) {
  for (const row of rows(sheet)) {
    const id = stableId(row, 'char', ['姓名', '角色名', 'name']);
    const name = String(pick(row, ['姓名', '角色名', 'name'], id));
    state.characters[id] = {
      ...(state.characters[id] || {}),
      id,
      name,
      identity: pick(row, ['身份', 'identity_text', 'identity']),
      appearance: pick(row, ['外貌', 'appearance']),
      personality: pick(row, ['性格', 'personality']),
      attitude: pick(row, ['对主角态度', 'attitude_to_protagonist', '态度']),
      relationship: pick(row, ['人际关系', 'relation_state', '关系']),
      speechStyle: pick(row, ['语言风格和口癖', 'speech_style', '语言风格']),
      past: pick(row, ['过往经历', 'past_experience']),
      legacy: sanitizeJson(row),
    };
  }
}

function addEntities(target, sheet, prefix, nameFields) {
  for (const row of rows(sheet)) {
    const id = stableId(row, prefix, nameFields);
    target[id] = { ...sanitizeJson(row), id, name: pick(row, nameFields, id) };
  }
}

function addLog(target, sheet, prefix) {
  for (const row of rows(sheet)) {
    target.push({
      id: stableId(row, prefix, ['标题', '概览', 'summary']),
      title: pick(row, ['标题', '事件类型', '类型']),
      time: pick(row, ['时间', '发生时间', '时间跨度', 'time']),
      summary: pick(row, ['概览', '总结', '日记内容', '内容', 'summary']),
      legacy: sanitizeJson(row),
    });
  }
}

export function importLegacyDatabase(input) {
  const sheets = tableList(input);
  if (!sheets.length) throw new Error('没有找到可识别的 sheet_* 数据表。请使用 SP 数据库的 JSON 导出，而不是脚本安装包。');

  const state = createDefaultState();
  const unknown = {};

  for (const sheet of sheets) {
    const name = sheet.name;
    if (['恋爱对象表', '重要角色表', '人物性格偏移表', '在场角色表'].includes(name)) {
      addCharacters(state, sheet);
    } else if (name === '主角信息表') {
      state.protagonist = { ...(rows(sheet)[0] || {}) };
    } else if (name === '全局数据表') {
      state.global = { ...(rows(sheet)[0] || {}) };
    } else if (name === '物品表') {
      addEntities(state.inventory, sheet, 'item', ['物品名称', '名称', 'name']);
    } else if (name === '主角技能表') {
      addEntities(state.skills, sheet, 'skill', ['技能名称', '名称', 'name']);
    } else if (name === '瑟瑟任务表') {
      addEntities(state.quests, sheet, 'quest', ['任务名称', '标题', 'name']);
    } else if (name === '检定建议表') {
      addEntities(state.checks, sheet, 'check', ['检定名称', '标题', 'name']);
    } else if (name === '纪要表') {
      addLog(state.chronicles, sheet, 'chronicle');
    } else if (name === '角色里程碑表') {
      addLog(state.milestones, sheet, 'milestone');
    } else if (name === '恋爱日记表') {
      addLog(state.diaries, sheet, 'diary');
    } else if (/大调查/.test(name)) {
      addLog(state.investigations, sheet, 'investigation');
    } else if (name === 'NSFW信息表') {
      state.adult.profiles = rows(sheet);
    } else if (name === '即时生理反应表') {
      state.adult.currentReactions = rows(sheet);
    } else {
      unknown[name] = rows(sheet);
    }
  }

  state.misc.legacyTables = unknown;
  state.misc.legacyImport = {
    importedAt: new Date().toISOString(),
    sheetCount: sheets.length,
    sheetNames: sheets.map((sheet) => sheet.name),
  };
  return normalizeState(state);
}
