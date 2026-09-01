import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateContentRegistry } from '../src/content-registry.js';

const registryUrl = new URL('../packs/yuzuki-native-app-content.json', import.meta.url);

test('native content registry contains four non-Mofo app columns', async () => {
  const registry = validateContentRegistry(JSON.parse(await readFile(registryUrl, 'utf8')));
  assert.equal(registry.type, 'yuzuki_native_story_app');
  assert.equal(registry.version, 2);
  assert.deepEqual(registry.items.map((item) => item.key), ['story', 'investigation', 'achievements', 'social']);
  assert.equal(registry.items.some((item) => 'tagName' in item || 'htmlTemplate' in item), false);
  assert.equal(registry.items.every((item) => item.outputContract && Object.keys(item.outputContract).length > 0), true);
});

test('investigation definition keeps the original dossier modules', async () => {
  const registry = validateContentRegistry(JSON.parse(await readFile(registryUrl, 'utf8')));
  const investigation = registry.items.find((item) => item.key === 'investigation');
  assert.ok(investigation.initialState.purity);
  assert.ok(investigation.initialState.development);
  assert.ok(investigation.initialState.appeal.voice);
  assert.match(investigation.promptTemplate, /V3\.647/);
  assert.deepEqual(Object.keys(investigation.outputContract.development), ['oral', 'hand', 'foot', 'breast', 'penis', 'genital', 'anal']);
  assert.deepEqual(Object.keys(investigation.outputContract.sexualStats.partners[0]), ['name', 'identity', 'relationship', 'coercion', 'share']);
  assert.match(investigation.promptTemplate, /至少6条/);
});

test('every array record has an explicit item contract instead of an empty schema', async () => {
  const registry = validateContentRegistry(JSON.parse(await readFile(registryUrl, 'utf8')));
  const story = registry.items.find((item) => item.key === 'story');
  const achievements = registry.items.find((item) => item.key === 'achievements');
  const social = registry.items.find((item) => item.key === 'social');
  assert.ok(story.outputContract.relations[0].name);
  assert.ok(achievements.outputContract.achievements[0].id);
  assert.ok(social.outputContract.posts[0].comments[0].author);
});
