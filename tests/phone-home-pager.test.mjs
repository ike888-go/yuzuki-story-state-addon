import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { paginateExtensionApps, YUZUKI_EXTENSION_APPS } from '../src/phone-home-pager.js';

test('places the content apps and WeChat wallet tool on the first extension desktop page', () => {
  assert.deepEqual(YUZUKI_EXTENSION_APPS.map((app) => app.name), ['剧情状态', '大调查', '成就册', '小红书', '微信余额']);
  assert.equal(new Set(YUZUKI_EXTENSION_APPS.map((app) => app.id)).size, 5);
  assert.equal(paginateExtensionApps(YUZUKI_EXTENSION_APPS).length, 1);
});

test('creates more extension desktop pages in groups of twelve', () => {
  const apps = Array.from({ length: 29 }, (_, index) => ({ id: `app-${index}` }));
  const pages = paginateExtensionApps(apps);
  assert.deepEqual(pages.map((page) => page.length), [12, 12, 5]);
});

test('pager patches only the running home instance and restores it on detach', async () => {
  const source = await readFile(new URL('../src/phone-home-pager.js', import.meta.url), 'utf8');
  assert.match(source, /this\.originalRender = home\.render/);
  assert.match(source, /this\.home\.render = this\.originalRender/);
  assert.match(source, /yssa-home-extension-page/);
  assert.doesNotMatch(source, /home\.apps\.push|saveApps/);
});
