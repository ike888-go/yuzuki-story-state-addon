import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateContentRegistry } from '../src/content-registry.js';

const registryUrl = new URL('../packs/yuzuki-native-app-content.json', import.meta.url);

test('native content registry contains four non-Mofo app columns', async () => {
  const registry = validateContentRegistry(JSON.parse(await readFile(registryUrl, 'utf8')));
  assert.equal(registry.type, 'yuzuki_native_story_app');
  assert.deepEqual(registry.items.map((item) => item.key), ['story', 'investigation', 'achievements', 'social']);
  assert.equal(registry.items.some((item) => 'tagName' in item || 'htmlTemplate' in item), false);
});

test('investigation definition keeps the original dossier modules', async () => {
  const registry = validateContentRegistry(JSON.parse(await readFile(registryUrl, 'utf8')));
  const investigation = registry.items.find((item) => item.key === 'investigation');
  assert.ok(investigation.initialState.purity);
  assert.ok(investigation.initialState.development);
  assert.ok(investigation.initialState.appeal.voice);
  assert.match(investigation.promptTemplate, /V3\.647/);
});
