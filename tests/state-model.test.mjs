import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPatch,
  createDefaultRoot,
  createDefaultState,
  extractStateBlocks,
  rebuildState,
} from '../src/state-model.js';

test('extracts and removes one same-response patch block', () => {
  const input = '剧情正文。\n<YUZUKI_STATE_PATCH>{"schemaVersion":1,"set":{"scene.location":"车站"}}</YUZUKI_STATE_PATCH>';
  const result = extractStateBlocks(input);
  assert.equal(result.cleanedText, '剧情正文。');
  assert.equal(result.patches[0].set['scene.location'], '车站');
});

test('applies set, upsert, append and remove operations', () => {
  const state = applyPatch(createDefaultState(), {
    set: { 'protagonist.name': '小柚', 'scene.time': '夜晚' },
    upsert: { characters: [{ id: 'c1', name: '柚月', attitude: '信任' }], inventory: [{ id: 'i1', name: '钥匙' }] },
    append: { chronicles: [{ id: 'log1', summary: '抵达车站' }] },
  });
  const next = applyPatch(state, {
    upsert: { characters: [{ id: 'c1', attitude: '担心' }] },
    remove: { inventory: ['i1'] },
  });
  assert.equal(next.protagonist.name, '小柚');
  assert.equal(next.characters.c1.name, '柚月');
  assert.equal(next.characters.c1.attitude, '担心');
  assert.equal(next.inventory.i1, undefined);
  assert.equal(next.chronicles[0].summary, '抵达车站');
});

test('rebuild follows the selected swipe only', () => {
  const root = createDefaultRoot();
  root.messagePatches['1:0'] = { patches: [{ set: { 'scene.location': '旧站台' } }] };
  root.messagePatches['1:1'] = { patches: [{ set: { 'scene.location': '新站台' } }] };
  const chat = [{ is_user: true, mes: '走吧' }, { is_user: false, mes: '到了', swipe_id: 1, swipes: ['A', 'B'] }];
  assert.equal(rebuildState(root, chat).state.scene.location, '新站台');
});

test('blocks prototype pollution paths', () => {
  const state = applyPatch(createDefaultState(), { set: { 'misc.__proto__.polluted': true } });
  assert.equal({}.polluted, undefined);
  assert.equal(state.misc.polluted, undefined);
});
