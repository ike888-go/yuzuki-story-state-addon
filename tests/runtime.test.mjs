import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { EXTENSION_KEY, StoryStateRuntime } from '../src/runtime.js';

test('captures a reply patch, scrubs the tag and persists chat metadata', async (t) => {
  const emitter = new EventEmitter();
  const prompts = [];
  const context = {
    chat: [],
    chatId: 'test-chat',
    chatMetadata: {},
    extensionSettings: {},
    eventSource: emitter,
    eventTypes: {
      MESSAGE_RECEIVED: 'message_received', MESSAGE_EDITED: 'message_edited', MESSAGE_SWIPED: 'message_swiped',
      MESSAGE_DELETED: 'message_deleted', CHAT_CHANGED: 'chat_changed',
      MESSAGE_SWIPE_DELETED: 'message_swipe_deleted',
    },
    saveSettingsDebounced() {},
    async saveChat() {},
    async updateMessageBlock() {},
    setExtensionPrompt(...args) { prompts.push(args); },
  };
  globalThis.SillyTavern = { getContext: () => context };
  globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
  globalThis.dispatchEvent = () => true;
  t.after(() => {
    delete globalThis.SillyTavern;
    delete globalThis.CustomEvent;
    delete globalThis.dispatchEvent;
  });

  const runtime = new StoryStateRuntime();
  await runtime.start();
  context.chat.push({
    is_user: false,
    mes: '她走进雨里。\n<YUZUKI_STATE_PATCH>{"schemaVersion":1,"set":{"scene.weather":"雨"}}</YUZUKI_STATE_PATCH>',
    swipe_id: 0,
    swipes: ['她走进雨里。\n<YUZUKI_STATE_PATCH>{"schemaVersion":1,"set":{"scene.weather":"雨"}}</YUZUKI_STATE_PATCH>'],
  });
  await runtime.processMessage(0, 'received');

  assert.equal(runtime.getState().scene.weather, '雨');
  assert.equal(context.chat[0].mes, '她走进雨里。');
  assert.ok(context.chatMetadata[EXTENSION_KEY].messagePatches['0:0']);
  assert.match(prompts.at(-1)[1], /YUZUKI_STATE_PATCH/);
  runtime.stop();
});

test('reindexes patch records after a message is deleted', async (t) => {
  const emitter = new EventEmitter();
  const context = {
    chat: [
      { is_user: false, mes: '第一条', swipe_id: 0, swipes: ['第一条'], extra: { [EXTENSION_KEY]: { swipes: { 0: 'record-a' } } } },
      { is_user: false, mes: '第二条', swipe_id: 0, swipes: ['第二条'], extra: { [EXTENSION_KEY]: { swipes: { 0: 'record-b' } } } },
    ],
    chatMetadata: { [EXTENSION_KEY]: { messagePatches: {
      '0:0': { id: 'record-a', patches: [{ set: { 'scene.location': 'A' } }] },
      '1:0': { id: 'record-b', patches: [{ set: { 'scene.location': 'B' } }] },
    } } },
    extensionSettings: {}, eventSource: emitter,
    eventTypes: { MESSAGE_DELETED: 'deleted' },
    saveSettingsDebounced() {}, async saveChat() {}, setExtensionPrompt() {},
  };
  globalThis.SillyTavern = { getContext: () => context };
  globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
  globalThis.dispatchEvent = () => true;
  t.after(() => { delete globalThis.SillyTavern; delete globalThis.CustomEvent; delete globalThis.dispatchEvent; });
  const runtime = new StoryStateRuntime();
  await runtime.start();
  context.chat.splice(0, 1);
  await runtime.reload('deleted', true);
  assert.equal(runtime.root.messagePatches['0:0'].id, 'record-b');
  assert.equal(runtime.getState().scene.location, 'B');
  runtime.stop();
});
