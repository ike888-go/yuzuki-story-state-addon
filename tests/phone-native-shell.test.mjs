import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/phone-studio-app.js', import.meta.url), 'utf8');

test('opens each feature as an independent native Yuzuki app without a shared navbar', () => {
  assert.match(source, /yssa-native-header/);
  assert.match(source, /YUZUKI_EXTENSION_APPS/);
  assert.match(source, /`yssa-native-\$\{tool\.key\}`/);
  assert.doesNotMatch(source, /yssa-native-tabbar|toolTabbar|TOOL_NAV/);
  assert.doesNotMatch(source, /renderHome|yssa-studio-home|yssa-home-clock/);
});

test('native app runtime has no Mofo import or event path', () => {
  assert.doesNotMatch(source, /mofo|魔坊/i);
  assert.match(source, /extension_settings|当前聊天|原生状态/i);
});
