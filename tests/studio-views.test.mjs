import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeAchievementState,
  normalizeInvestigationState,
  normalizeSocialState,
  normalizeStoryState,
  renderAchievements,
  renderInvestigation,
  renderSocial,
  renderStoryState,
} from '../src/studio-views.js';

test('legacy flat states remain visible after the rich-app migration', () => {
  assert.equal(normalizeStoryState({ chapter: '旧章' }).scene.chapter, '旧章');
  assert.equal(normalizeInvestigationState({ target: '林姐' }).meta.target, '林姐');
  assert.equal(normalizeAchievementState({ a1Name: '初见' }).achievements[0].name, '初见');
  assert.equal(normalizeSocialState({ p1Title: '雨天', p1Body: '散步' }).posts[0].title, '雨天');
});

test('each tool renders a distinct app information architecture', () => {
  assert.match(renderStoryState({ scene: { chapter: '雨夜' }, protagonist: {} }), /data-yssa-tab="shop"/);
  assert.match(renderInvestigation({ meta: { target: '林姐' }, appeal: {}, portrait: {} }), /yssa-purity-ring/);
  assert.match(renderAchievements({ summary: {}, achievements: [] }), /yssa-achievement-grid/);
  assert.match(renderSocial({ profile: {}, posts: [] }), /yssa-xhs-feed/);
});

test('all model text is escaped before entering app markup', () => {
  const html = renderSocial({
    profile: { name: '<img src=x onerror=1>', handle: 'x', bio: '', avatar: 'X' },
    posts: [{ id: '1', title: '<script>alert(1)</script>', body: '', comments: [] }],
  });
  assert.doesNotMatch(html, /<(?:script|img)\b/i);
  assert.match(html, /&lt;script&gt;/);
});
