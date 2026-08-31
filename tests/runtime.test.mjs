import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { ContentAddonRuntime, EXTENSION_KEY } from '../src/runtime.js';

const registry = JSON.parse(await readFile(new URL('../packs/yuzuki-native-app-content.json', import.meta.url), 'utf8'));

function installGlobals(t, { sessionRef = { value: 'chat-one' } } = {}) {
  const emitter = new EventEmitter();
  const context = {
    extensionSettings: {},
    eventSource: emitter,
    eventTypes: { APP_READY: 'ready', CHAT_CHANGED: 'chat', MESSAGE_RECEIVED: 'message' },
    saveSettingsDebounced() {},
    name1: '用户',
    name2: '角色',
    chat: [],
  };
  const previous = {
    SillyTavern: globalThis.SillyTavern,
    VirtualPhone: globalThis.VirtualPhone,
    YuzukiMemory: globalThis.YuzukiMemory,
    fetch: globalThis.fetch,
    CustomEvent: globalThis.CustomEvent,
    dispatchEvent: globalThis.dispatchEvent,
  };
  globalThis.SillyTavern = { getContext: () => context };
  globalThis.VirtualPhone = { home: { phoneShell: { setContent() {} } }, apiManager: { callAI() {} } };
  globalThis.YuzukiMemory = {
    Storage: {
      getCurrentSessionId: () => sessionRef.value,
      loadState: () => ({ records: { memory_summary: [{ values: { 摘要: '测试总结' } }] } }),
    },
    VariableInjector: {
      createDefaultState: () => ({ records: {} }),
      buildSummaryText: () => '测试总结',
    },
  };
  globalThis.fetch = async () => ({ ok: true, json: async () => structuredClone(registry) });
  globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
  globalThis.dispatchEvent = () => true;
  t.after(() => {
    Object.entries(previous).forEach(([key, value]) => {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    });
  });
  return { context, sessionRef };
}

test('starts as a native Yuzuki app without any Mofo runtime', async (t) => {
  const { context } = installGlobals(t);
  const runtime = new ContentAddonRuntime();
  await runtime.start();
  assert.equal(runtime.getStatus().phoneReady, true);
  assert.equal(runtime.getStatus().storageReady, true);
  assert.equal(runtime.getStatus().memoryReady, true);
  assert.equal(runtime.getStatus().chatKey, 'memory:chat-one');
  assert.equal(runtime.getGenerationItem('yssa_current_story_state').state.scene.chapter, '尚未生成');
  assert.equal('packRevision' in context.extensionSettings[EXTENSION_KEY], false);
  assert.deepEqual(context.extensionSettings[EXTENSION_KEY].nativeStates, {});
  runtime.stop();
});

test('runtime reads and writes a different native state for each chat', async (t) => {
  const sessionRef = { value: 'chat-one' };
  installGlobals(t, { sessionRef });
  const runtime = new ContentAddonRuntime();
  await runtime.start();
  runtime.updateToolState('yssa_achievement_book', { summary: { total: 1 }, achievements: [], nextGoals: [] });
  sessionRef.value = 'chat-two';
  assert.equal(runtime.getGenerationItem('yssa_achievement_book').state.summary.total, 0);
  runtime.updateToolState('yssa_achievement_book', { summary: { total: 9 }, achievements: [], nextGoals: [] });
  sessionRef.value = 'chat-one';
  assert.equal(runtime.getGenerationItem('yssa_achievement_book').state.summary.total, 1);
  runtime.stop();
});

test('persists and resets editable prompt overrides', async (t) => {
  installGlobals(t);
  const runtime = new ContentAddonRuntime();
  await runtime.start();
  const defaultPrompt = runtime.getPrompt('yssa_investigation_report');
  assert.match(defaultPrompt, /V3\.647/);
  runtime.savePrompt('yssa_investigation_report', '我的自定义调查提示词');
  assert.equal(runtime.getPrompt('yssa_investigation_report'), '我的自定义调查提示词');
  runtime.resetPrompt('yssa_investigation_report');
  assert.equal(runtime.getPrompt('yssa_investigation_report'), defaultPrompt);
  runtime.stop();
});
