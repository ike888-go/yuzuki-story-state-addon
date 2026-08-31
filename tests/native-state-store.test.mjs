import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeStateStore, resolveNativeChatKey } from '../src/native-state-store.js';

test('prefers the Yuzuki Memory session as the native chat key', () => {
  const key = resolveNativeChatKey({ chatId: 'chat-fallback' }, { Storage: { getCurrentSessionId: () => 'memory-7' } });
  assert.equal(key, 'memory:memory-7');
});

test('stores independent native app state for each chat', (t) => {
  let session = 'one';
  const previous = globalThis.YuzukiMemory;
  globalThis.YuzukiMemory = { Storage: { getCurrentSessionId: () => session } };
  t.after(() => {
    if (previous === undefined) delete globalThis.YuzukiMemory;
    else globalThis.YuzukiMemory = previous;
  });
  const settings = { nativeStates: {} };
  const registry = { items: [{ id: 'story', initialState: { chapter: '初始' } }] };
  let saves = 0;
  const store = new NativeStateStore({
    getContext: () => ({ chatId: 'fallback' }),
    getSettings: () => settings,
    saveSettings: () => { saves += 1; },
    getRegistry: () => registry,
  });
  store.update('story', { chapter: '第一章' });
  session = 'two';
  assert.equal(store.getItem('story').state.chapter, '初始');
  store.update('story', { chapter: '第二章' });
  session = 'one';
  assert.equal(store.getItem('story').state.chapter, '第一章');
  assert.equal(saves, 2);
});
