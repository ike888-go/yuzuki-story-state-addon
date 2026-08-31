import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MEMORY_ITEM_ID, PACK_TYPE, validateImportPack } from '../src/pack-registry.js';

const packUrl = new URL('../packs/yuzuki-mofo-content-pack.json', import.meta.url);

test('bundled content pack follows the official Mofo import shape', async () => {
  const pack = validateImportPack(JSON.parse(await readFile(packUrl, 'utf8')));
  assert.equal(pack.type, PACK_TYPE);
  assert.equal(pack.count, 5);
  assert.equal(pack.items.length, 5);
  assert.ok(pack.items.some((item) => item.id === MEMORY_ITEM_ID));
  assert.ok(pack.items.every((item) => item.offlinePromptEnabled === false));
});

test('content pack templates contain no executable markup', async () => {
  const pack = validateImportPack(JSON.parse(await readFile(packUrl, 'utf8')));
  for (const item of pack.items) {
    assert.doesNotMatch(item.htmlTemplate, /<(?:script|iframe)\b|\son[a-z]+\s*=|javascript:/i);
  }
});

test('rejects duplicate stable IDs', () => {
  const item = { id: MEMORY_ITEM_ID, name: '记忆', tagName: '记忆', htmlTemplate: '<section></section>', initialState: {} };
  assert.throws(() => validateImportPack({ type: PACK_TYPE, version: 1, items: [item, item] }), /重复/);
});
