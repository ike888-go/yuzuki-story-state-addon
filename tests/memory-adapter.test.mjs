import test from 'node:test';
import assert from 'node:assert/strict';
import { readMemorySnapshot } from '../src/memory-adapter.js';

test('projects official Yuzuki Memory tables without saving them', () => {
  let saveCalls = 0;
  const state = {
    records: {
      plot_summary: [{ id: 'p1', values: { 标题: '雨夜', 内容: '两人在车站重逢' } }],
      character_profile: [{ id: 'c1', values: { 姓名: '柚月', 关系: '同伴' } }],
      item_tracking: [{ id: 'i1', values: { 名称: '钥匙', 状态: '持有' } }],
      world_setting: [{ id: 'w1', values: { 名称: '旧车站', 描述: '夜间停运' } }],
      memory_summary: [{ id: 's1', values: { 总结内容: '主线继续推进' } }],
    },
  };
  const memory = {
    Storage: {
      getCurrentSessionId: () => 'chat-1',
      loadState: () => state,
      saveState: () => { saveCalls += 1; },
    },
    VariableInjector: {
      createDefaultState: () => ({ records: {} }),
      buildSummaryText: () => '【主线总结】\n主线继续推进',
    },
  };
  const result = readMemorySnapshot(memory, new Date('2026-08-31T12:00:00+08:00'));
  assert.equal(result.available, true);
  assert.equal(result.state.session, 'chat-1');
  assert.equal(result.state.recordCount, 5);
  assert.match(result.state.summary, /主线继续推进/);
  assert.match(result.state.characters, /柚月/);
  assert.equal(saveCalls, 0);
});

test('returns a clear waiting state when the memory plugin is unavailable', () => {
  const result = readMemorySnapshot(undefined);
  assert.equal(result.available, false);
  assert.match(result.state.status, /等待/);
});
