import { resolveMofoData, updateItemState } from './mofo-adapter.js';

export const GENERATION_TOOLS = Object.freeze([
  {
    id: 'yssa_current_story_state',
    key: 'story',
    name: '剧情状态',
    icon: '◈',
    eyebrow: 'STORY NOW',
    description: '像原状态栏一样查看场景、人物关系、线索、玩法与灵感商店。',
    temperature: 0.35,
    maxTokens: 4200,
  },
  {
    id: 'yssa_investigation_report',
    key: 'investigation',
    name: '角色大调查',
    icon: '⌕',
    eyebrow: 'PRIVATE DOSSIER',
    description: '按色色灵感状态栏原版结构生成完整私密档案。',
    needsTarget: true,
    temperature: 0.45,
    maxTokens: 8000,
  },
  {
    id: 'yssa_achievement_book',
    key: 'achievements',
    name: '剧情成就',
    icon: '✦',
    eyebrow: 'ACHIEVEMENTS',
    description: '以卡册方式回顾已解锁、隐藏与进行中的剧情成就。',
    temperature: 0.5,
    maxTokens: 3200,
  },
  {
    id: 'yssa_social_notes',
    key: 'social',
    name: '小红书',
    icon: '♡',
    eyebrow: 'SOCIAL NOTES',
    description: '双列信息流、笔记详情、评论与角色主页。',
    temperature: 0.72,
    maxTokens: 5200,
  },
]);

const TOOL_BY_ID = new Map(GENERATION_TOOLS.map((tool) => [tool.id, tool]));

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function text(value, maxLength = 4000) {
  const normalized = String(value ?? '').replace(/\u0000/g, '').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized;
}

function findBalancedObject(source) {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') {
      if (depth === 0) start = index;
      depth += 1;
    } else if (char === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) return source.slice(start, index + 1);
    }
  }
  return '';
}

export function parseGeneratedObject(rawValue) {
  const raw = text(rawValue, 100000)
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  if (!raw) throw new Error('AI 没有返回内容。');

  const candidates = [raw, findBalancedObject(raw)].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (isPlainObject(parsed)) return parsed;
    } catch (_error) {
      // Continue to the next candidate so a short preface does not break parsing.
    }
  }
  throw new Error('AI 返回的不是有效 JSON，请点击重试。');
}

export function normalizeGeneratedState(parsed, initialState = {}, currentState = {}) {
  if (!isPlainObject(parsed)) throw new Error('生成结果必须是 JSON 对象。');
  const schema = isPlainObject(initialState) ? initialState : {};
  const current = isPlainObject(currentState) ? currentState : {};
  const allowedKeys = Object.keys(schema);
  const matchedKeys = allowedKeys.filter((key) => Object.prototype.hasOwnProperty.call(parsed, key));
  if (matchedKeys.length === 0) throw new Error('生成结果没有包含模板所需字段。');

  const normalizeValue = (value, schemaValue, fallback) => {
    if (Array.isArray(schemaValue)) {
      return Array.isArray(value) ? clone(value) : (Array.isArray(fallback) ? clone(fallback) : []);
    }
    if (isPlainObject(schemaValue)) {
      if (!Object.keys(schemaValue).length) {
        return isPlainObject(value) ? clone(value) : (isPlainObject(fallback) ? clone(fallback) : {});
      }
      const source = isPlainObject(value) ? value : {};
      const previous = isPlainObject(fallback) ? fallback : {};
      return Object.fromEntries(Object.keys(schemaValue).map((childKey) => [
        childKey,
        normalizeValue(
          Object.prototype.hasOwnProperty.call(source, childKey) ? source[childKey] : previous[childKey],
          schemaValue[childKey],
          previous[childKey] ?? schemaValue[childKey],
        ),
      ]));
    }
    if (typeof schemaValue === 'number') {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : Number(fallback) || 0;
    }
    if (typeof schemaValue === 'boolean') return value === true || value === 'true' || value === 1;
    return text(value ?? fallback, 24000);
  };

  const output = {};
  for (const key of allowedKeys) {
    const fallback = Object.prototype.hasOwnProperty.call(current, key) ? current[key] : schema[key];
    const value = Object.prototype.hasOwnProperty.call(parsed, key) ? parsed[key] : fallback;
    output[key] = normalizeValue(value, schema[key], fallback);
  }
  return output;
}

function stripAddonProtocol(value) {
  return String(value || '')
    .replace(/<柚月(?:当前状态|大调查|成就册|社交笔记|记忆快照)>[\s\S]*?<\/柚月(?:当前状态|大调查|成就册|社交笔记|记忆快照)>/gi, '')
    .trim();
}

function buildCharacterContext(context) {
  const character = context?.characterId !== undefined && Array.isArray(context?.characters)
    ? context.characters[context.characterId]
    : null;
  const parts = [
    `用户：${text(context?.name1 || '用户', 120)}`,
    `当前角色：${text(character?.name || context?.name2 || '角色', 120)}`,
  ];
  if (character?.description) parts.push(`角色设定：${text(character.description, 2600)}`);
  if (character?.personality) parts.push(`角色性格：${text(character.personality, 1200)}`);
  if (character?.scenario || context?.scenario) parts.push(`场景背景：${text(character?.scenario || context.scenario, 1600)}`);
  const persona = typeof document !== 'undefined'
    ? text(document.getElementById('persona_description')?.value, 1200)
    : '';
  if (persona) parts.push(`用户人设：${persona}`);
  return parts.join('\n');
}

function buildRecentChat(context) {
  const chat = Array.isArray(context?.chat) ? context.chat : [];
  const selected = chat.slice(-16);
  let budget = 14000;
  const rows = [];
  for (let index = selected.length - 1; index >= 0 && budget > 0; index -= 1) {
    const message = selected[index] || {};
    const role = message.is_user || message.role === 'user'
      ? (context?.name1 || '用户')
      : (context?.name2 || '角色');
    const raw = stripAddonProtocol(message.mes ?? message.content ?? '');
    if (!raw) continue;
    const chunk = text(raw, Math.min(2600, budget));
    budget -= chunk.length;
    rows.unshift(`${role}：${chunk}`);
  }
  return rows.length ? rows.join('\n\n') : '当前聊天还没有可用的剧情消息。';
}

function buildMemoryContext(mofoData) {
  const item = mofoData?.getItemById?.('yssa_memory_snapshot')
    || mofoData?.getItems?.().find((candidate) => candidate?.id === 'yssa_memory_snapshot');
  const state = isPlainObject(item?.state) ? item.state : {};
  const parts = [];
  for (const key of ['summary', 'plot', 'characters', 'items', 'world']) {
    if (state[key]) parts.push(`${key}：${text(state[key], 1600)}`);
  }
  return parts.length ? parts.join('\n') : '暂无可用记忆快照。';
}

export function buildGenerationMessages({
  context,
  item,
  mofoData,
  target = '',
  promptOverride = '',
  extraInstructions = '',
  continueFromCurrent = false,
}) {
  const tool = TOOL_BY_ID.get(item?.id);
  if (!tool) throw new Error('不支持这个生成项目。');
  const targetLine = tool.needsTarget ? `\n指定调查对象：${text(target, 160)}` : '';
  const schema = JSON.stringify(item.initialState || item.state || {});
  const prompt = text(promptOverride || item.promptTemplate, 32000);
  if (!prompt) throw new Error('这个魔坊模板没有生成提示词。');
  const extra = text(extraInstructions, 4000);
  const baseline = continueFromCurrent && isPlainObject(item?.state)
    ? `\n【当前档案基线】\n${JSON.stringify(item.state)}\n请根据新剧情更新这份基线，仍返回包含全部字段的完整 JSON。未变化字段保留原值。`
    : '';

  return [
    {
      role: 'system',
      content: [
        '你是柚月剧情工坊的数据整理与应用内容生成助手。',
        '只依据给出的角色设定、记忆和最近剧情工作；未知内容必须明确写未知，不得伪造事实。',
        '最终只返回一个 JSON 对象，不要 Markdown、代码围栏、解释、标签或额外文字。',
        '数组必须保持为数组，对象必须保持为对象，不得把结构化内容改写成带换行的长字符串。',
        `允许的完整数据结构以这个对象为准：${schema}`,
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `任务：${prompt}${targetLine}`,
        extra ? `\n【本次额外要求】\n${extra}` : '',
        baseline,
        `\n【角色与场景】\n${buildCharacterContext(context)}`,
        `\n【柚月记忆快照】\n${buildMemoryContext(mofoData)}`,
        `\n【最近剧情】\n${buildRecentChat(context)}`,
      ].join('\n'),
    },
  ];
}

export function sanitizeGenerationError(error) {
  return text(error?.message || error || '生成失败', 1200)
    .replace(/https?:\/\/[^\s"']+/gi, '[API 地址]')
    .replace(/(?:sk|key)-[a-z0-9_-]{8,}/gi, '[已隐藏密钥]');
}

export class GenerationService {
  constructor(getContext, getPromptOverride = () => '') {
    this.getContext = getContext;
    this.getPromptOverride = getPromptOverride;
    this.activeController = null;
    this.activeToolId = '';
  }

  getTool(toolId) {
    return TOOL_BY_ID.get(toolId) || null;
  }

  getItem(toolId) {
    const mofoData = resolveMofoData(globalThis);
    if (!mofoData) return null;
    return mofoData.getItemById?.(toolId)
      || mofoData.getItems().find((item) => String(item?.id || '') === String(toolId))
      || null;
  }

  getSuggestedTargets() {
    const context = this.getContext();
    const names = new Set();
    if (context?.name2) names.add(text(context.name2, 120));
    if (Array.isArray(context?.characters)) {
      context.characters.forEach((character) => {
        if (character?.name) names.add(text(character.name, 120));
      });
    }
    return [...names].filter(Boolean).slice(0, 30);
  }

  cancel() {
    this.activeController?.abort();
  }

  async generate(toolId, { target = '', extraInstructions = '', continueFromCurrent = false } = {}) {
    const tool = this.getTool(toolId);
    if (!tool) throw new Error('未知的生成项目。');
    if (this.activeController) throw new Error('已有生成任务正在进行，请先停止或等待完成。');
    if (tool.needsTarget && !text(target, 160)) throw new Error('请先填写调查对象。');

    const mofoData = resolveMofoData(globalThis);
    if (!mofoData) throw new Error('魔坊尚未就绪，请先打开一次柚月手机的魔坊。');
    const item = this.getItem(toolId);
    if (!item) throw new Error('找不到对应模板，请先安装缺失模板。');
    const apiManager = globalThis.VirtualPhone?.apiManager;
    if (!apiManager?.callAI) throw new Error('柚月手机 API 管理器尚未就绪。');

    const controller = new AbortController();
    this.activeController = controller;
    this.activeToolId = toolId;
    try {
      const messages = buildGenerationMessages({
        context: this.getContext(),
        item,
        mofoData,
        target,
        promptOverride: this.getPromptOverride(toolId, item.promptTemplate),
        extraInstructions,
        continueFromCurrent,
      });
      const result = await apiManager.callAI(messages, {
        appId: 'phone_online',
        temperature: tool.temperature,
        max_tokens: tool.maxTokens,
        min_max_tokens: Math.min(1200, tool.maxTokens),
        signal: controller.signal,
      });
      if (controller.signal.aborted || result?.aborted) throw new DOMException('已停止生成', 'AbortError');
      if (!result?.success) throw new Error(result?.error || 'AI 生成失败。');
      const raw = result.summary || result.content || result.text || '';
      const parsed = parseGeneratedObject(raw);
      const state = normalizeGeneratedState(parsed, item.initialState, item.state);
      const updated = updateItemState(mofoData, toolId, state, 'yuzuki-story-studio-ai');
      if (!updated) throw new Error('生成成功，但写入魔坊状态失败。');
      return { tool: clone(tool), state: clone(state), item: clone(updated) };
    } finally {
      if (this.activeController === controller) {
        this.activeController = null;
        this.activeToolId = '';
      }
    }
  }
}
