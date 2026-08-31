import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GenerationService,
  buildGenerationMessages,
  normalizeGeneratedState,
  parseGeneratedObject,
  sanitizeGenerationError,
} from '../src/generation-service.js';

test('parses a JSON object from a fenced or prefaced AI response', () => {
  assert.deepEqual(parseGeneratedObject('```json\n{"chapter":"第一幕"}\n```'), { chapter: '第一幕' });
  assert.deepEqual(parseGeneratedObject('结果如下：\n{"chapter":"第二幕","note":"含有 } 字符"}'), {
    chapter: '第二幕',
    note: '含有 } 字符',
  });
});

test('normalizes output to the template schema and preserves missing fields', () => {
  const result = normalizeGeneratedState(
    { total: '4', latest: '初见', ignored: 'no' },
    { total: 0, latest: '', progress: '' },
    { total: 2, latest: '旧', progress: '继续调查' },
  );
  assert.deepEqual(result, { total: 4, latest: '初见', progress: '继续调查' });
});

test('preserves structured app arrays and nested objects instead of flattening them to text', () => {
  const result = normalizeGeneratedState(
    { scene: { title: '雨夜' }, posts: [{ id: 'p1', title: '一场雨' }] },
    { scene: { title: '', location: '' }, posts: [] },
    { scene: { title: '旧章', location: '车站' }, posts: [] },
  );
  assert.deepEqual(result, {
    scene: { title: '雨夜', location: '车站' },
    posts: [{ id: 'p1', title: '一场雨' }],
  });
});

test('builds bounded roleplay context without requesting a normal chat turn', () => {
  const item = {
    id: 'yssa_investigation_report',
    promptTemplate: '生成调查 JSON',
    initialState: { target: '', conclusion: '' },
  };
  const mofoData = {
    getItemById: () => ({ state: { summary: '前情总结' } }),
    getItems: () => [],
  };
  const messages = buildGenerationMessages({
    context: { name1: '用户', name2: '柚月', chat: [{ is_user: true, mes: '调查林姐' }] },
    item,
    mofoData,
    target: '林姐',
  });
  assert.equal(messages.length, 2);
  assert.match(messages[0].content, /只返回一个 JSON 对象/);
  assert.match(messages[1].content, /指定调查对象：林姐/);
  assert.match(messages[1].content, /调查林姐/);
});

test('uses an editable prompt, one-off instructions and the current dossier baseline', () => {
  const item = {
    id: 'yssa_investigation_report',
    promptTemplate: '默认提示词',
    initialState: { target: '', portrait: '' },
    state: { target: '林姐', portrait: '旧档案' },
  };
  const messages = buildGenerationMessages({
    context: { name1: '用户', name2: '角色', chat: [] },
    item,
    mofoData: { getItemById: () => null, getItems: () => [] },
    target: '林姐',
    promptOverride: '自定义完整提示词',
    extraInstructions: '侧重心理变化',
    continueFromCurrent: true,
  });
  assert.match(messages[1].content, /自定义完整提示词/);
  assert.doesNotMatch(messages[1].content, /任务：默认提示词/);
  assert.match(messages[1].content, /侧重心理变化/);
  assert.match(messages[1].content, /当前档案基线/);
  assert.match(messages[1].content, /旧档案/);
});

test('uses the official phone AI manager and saves generated state to Mofo', async (t) => {
  const items = [{
    id: 'yssa_current_story_state',
    promptTemplate: '生成状态',
    initialState: { chapter: '', location: '' },
    state: { chapter: '旧章', location: '旧地' },
  }];
  const mofoData = {
    getItems: () => structuredClone(items),
    getItemById: (id) => structuredClone(items.find((item) => item.id === id) || null),
    createItem() {},
    updateItem(id, patch) {
      const item = items.find((candidate) => candidate.id === id);
      Object.assign(item, structuredClone(patch));
      return structuredClone(item);
    },
  };
  const previous = globalThis.VirtualPhone;
  globalThis.VirtualPhone = {
    cachedMofoData: mofoData,
    apiManager: {
      async callAI(messages, options) {
        assert.equal(options.appId, 'phone_online');
        assert.equal(messages.at(-1).role, 'user');
        return { success: true, summary: '{"chapter":"新章","location":"车站"}' };
      },
    },
  };
  t.after(() => {
    if (previous === undefined) delete globalThis.VirtualPhone;
    else globalThis.VirtualPhone = previous;
  });

  const service = new GenerationService(() => ({ name1: '用户', name2: '角色', chat: [] }));
  const result = await service.generate('yssa_current_story_state');
  assert.deepEqual(result.state, { chapter: '新章', location: '车站' });
  assert.equal(items[0].state.chapter, '新章');
  assert.equal(items[0].lastUpdatedBy, 'yuzuki-story-studio-ai');
});

test('redacts API URLs and likely keys from displayed errors', () => {
  const message = sanitizeGenerationError(new Error('request https://secret.example/v1 key-abcd12345678 failed'));
  assert.doesNotMatch(message, /secret\.example|abcd12345678/);
});
