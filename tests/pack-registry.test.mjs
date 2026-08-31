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

test('investigation template uses the original dossier modules instead of the generic report', async () => {
  const pack = validateImportPack(JSON.parse(await readFile(packUrl, 'utf8')));
  const investigation = pack.items.find((item) => item.id === 'yssa_investigation_report');
  assert.ok(investigation);
  for (const key of ['meta', 'portrait', 'psychology', 'purity', 'sexualStats', 'fertility', 'development', 'masturbation', 'experiences', 'appeal']) {
    assert.ok(Object.hasOwn(investigation.initialState, key), `missing ${key}`);
  }
  assert.ok(Object.hasOwn(investigation.initialState.appeal, 'voice'));
  assert.ok(Object.hasOwn(investigation.initialState.development, 'genital'));
  assert.match(investigation.promptTemplate, /V3\.647/);
  assert.match(investigation.promptTemplate, /使人怀孕次数/);
  assert.match(investigation.promptTemplate, /rumors 至少6项/);
  assert.doesNotMatch(investigation.promptTemplate, /下一步调查或互动建议/);
});

test('rejects duplicate stable IDs', () => {
  const item = { id: MEMORY_ITEM_ID, name: '记忆', tagName: '记忆', htmlTemplate: '<section></section>', initialState: {} };
  assert.throws(() => validateImportPack({ type: PACK_TYPE, version: 1, items: [item, item] }), /重复/);
});
