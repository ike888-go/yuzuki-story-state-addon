import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { ContentAddonRuntime, EXTENSION_KEY } from '../src/runtime.js';

const pack = JSON.parse(await readFile(new URL('../packs/yuzuki-mofo-content-pack.json', import.meta.url), 'utf8'));

function fakeMofo() {
  const items = [];
  return {
    getItems: () => structuredClone(items),
    getItemById: (id) => structuredClone(items.find((item) => item.id === id) || null),
    createItem(input) { items.push(structuredClone(input)); return structuredClone(input); },
    updateItem(id, patch) {
      const item = items.find((candidate) => candidate.id === id);
      if (!item) return null;
      Object.assign(item, structuredClone(patch));
      return structuredClone(item);
    },
  };
}

test('installs the pack and syncs memory without prompts or AI calls', async (t) => {
  const emitter = new EventEmitter();
  const mofo = fakeMofo();
  let promptCalls = 0;
  let aiCalls = 0;
  const context = {
    extensionSettings: {},
    eventSource: emitter,
    eventTypes: { APP_READY: 'ready', CHAT_CHANGED: 'chat', MESSAGE_RECEIVED: 'message' },
    saveSettingsDebounced() {},
    setExtensionPrompt() { promptCalls += 1; },
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
  globalThis.VirtualPhone = { cachedMofoData: mofo, apiManager: { callAI() { aiCalls += 1; } } };
  globalThis.YuzukiMemory = {
    Storage: { getCurrentSessionId: () => 'chat-1', loadState: () => ({ records: { memory_summary: [] } }) },
    VariableInjector: { createDefaultState: () => ({ records: {} }), buildSummaryText: () => '测试总结' },
  };
  globalThis.fetch = async () => ({ ok: true, json: async () => structuredClone(pack) });
  globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
  globalThis.dispatchEvent = () => true;
  t.after(() => {
    Object.entries(previous).forEach(([key, value]) => {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    });
  });

  const runtime = new ContentAddonRuntime();
  await runtime.start();
  assert.equal(mofo.getItems().length, 5);
  assert.equal(mofo.getItemById('yssa_memory_snapshot').state.summary, '测试总结');
  assert.equal(context.extensionSettings[EXTENSION_KEY].packRevision, 2);
  assert.equal(promptCalls, 0);
  assert.equal(aiCalls, 0);
  runtime.stop();
});

test('does not recreate user-deleted templates after the content revision was installed', async (t) => {
  const emitter = new EventEmitter();
  const mofo = fakeMofo();
  const context = {
    extensionSettings: { [EXTENSION_KEY]: { autoInstall: true, memorySync: true, packRevision: 1 } },
    eventSource: emitter,
    eventTypes: {},
    saveSettingsDebounced() {},
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
  globalThis.VirtualPhone = { cachedMofoData: mofo };
  globalThis.YuzukiMemory = {
    Storage: { getCurrentSessionId: () => 'chat-1', loadState: () => ({ records: {} }) },
    VariableInjector: { createDefaultState: () => ({ records: {} }), buildSummaryText: () => '' },
  };
  globalThis.fetch = async () => ({ ok: true, json: async () => structuredClone(pack) });
  globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
  globalThis.dispatchEvent = () => true;
  t.after(() => {
    Object.entries(previous).forEach(([key, value]) => {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    });
  });

  const runtime = new ContentAddonRuntime();
  await runtime.start();
  assert.equal(mofo.getItems().length, 0);
  assert.equal(context.extensionSettings[EXTENSION_KEY].packRevision, 2);
  runtime.stop();
});

test('persists, uses and resets editable prompt overrides', async (t) => {
  const emitter = new EventEmitter();
  const mofo = fakeMofo();
  let saves = 0;
  const context = {
    extensionSettings: {},
    eventSource: emitter,
    eventTypes: {},
    saveSettingsDebounced() { saves += 1; },
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
  globalThis.VirtualPhone = { cachedMofoData: mofo };
  globalThis.YuzukiMemory = {};
  globalThis.fetch = async () => ({ ok: true, json: async () => structuredClone(pack) });
  globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
  globalThis.dispatchEvent = () => true;
  t.after(() => {
    Object.entries(previous).forEach(([key, value]) => {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    });
  });

  const runtime = new ContentAddonRuntime();
  await runtime.start();
  const defaultPrompt = runtime.getPrompt('yssa_investigation_report');
  assert.match(defaultPrompt, /纯洁档案/);
  runtime.savePrompt('yssa_investigation_report', '我的自定义调查提示词');
  assert.equal(runtime.getPrompt('yssa_investigation_report'), '我的自定义调查提示词');
  assert.equal(runtime.isPromptCustomized('yssa_investigation_report'), true);
  runtime.resetPrompt('yssa_investigation_report');
  assert.equal(runtime.getPrompt('yssa_investigation_report'), defaultPrompt);
  assert.equal(runtime.isPromptCustomized('yssa_investigation_report'), false);
  assert.ok(saves >= 3);
  runtime.stop();
});
