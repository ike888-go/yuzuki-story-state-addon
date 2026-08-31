import test from 'node:test';
import assert from 'node:assert/strict';
import { importLegacyDatabase } from '../src/legacy-import.js';

test('imports representative SP database sheets', () => {
  const input = {
    sheet_main: { name: '主角信息表', content: [['姓名', '年龄'], ['小柚', '20岁']] },
    sheet_chars: { name: '恋爱对象表', content: [['姓名', '身份', '对主角态度'], ['柚月', '同伴', '有些在意']] },
    sheet_items: { name: '物品表', content: [['row_id', '物品名称', '数量'], ['1', '钥匙', '1']] },
    sheet_log: { name: '纪要表', content: [['标题', '概览', '时间'], ['相遇', '两人在车站相遇', '夜晚']] },
  };
  const state = importLegacyDatabase(input);
  assert.equal(state.protagonist.姓名, '小柚');
  assert.equal(state.characters['柚月'].identity, '同伴');
  assert.equal(state.inventory['1'].name, '钥匙');
  assert.equal(state.chronicles[0].summary, '两人在车站相遇');
});

test('rejects a script installer JSON as a data export', () => {
  assert.throws(() => importLegacyDatabase({ name: '色色灵感状态栏V3.647', content: 'script code' }), /sheet_\*/);
});
