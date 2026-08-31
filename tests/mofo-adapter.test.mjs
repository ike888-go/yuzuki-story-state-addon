import test from 'node:test';
import assert from 'node:assert/strict';
import { installMissingItems, updateItemState, upgradeManagedItems } from '../src/mofo-adapter.js';

function fakeMofo(initial = []) {
  const items = structuredClone(initial);
  return {
    getItems: () => structuredClone(items),
    getItemById: (id) => structuredClone(items.find((item) => item.id === id) || null),
    createItem(input) {
      const item = structuredClone(input);
      items.push(item);
      return structuredClone(item);
    },
    updateItem(id, patch) {
      const item = items.find((candidate) => candidate.id === id);
      if (!item) return null;
      Object.assign(item, structuredClone(patch));
      return structuredClone(item);
    },
  };
}

test('installs only missing items and preserves customized definitions', () => {
  const mofo = fakeMofo([{ id: 'one', name: '状态', tagName: '状态', htmlTemplate: '用户自定义' }]);
  const pack = { items: [
    { id: 'one', name: '状态', tagName: '状态', htmlTemplate: '内置版本', initialState: {} },
    { id: 'two', name: '调查', tagName: '调查', htmlTemplate: '<section></section>', initialState: {} },
  ] };
  const result = installMissingItems(mofo, pack);
  assert.deepEqual(result.existing, ['one']);
  assert.deepEqual(result.installed, ['two']);
  assert.equal(mofo.getItemById('one').htmlTemplate, '用户自定义');
});

test('does not create a duplicate when name or tag collides', () => {
  const mofo = fakeMofo([{ id: 'local', name: '角色大调查', tagName: '我的调查' }]);
  const result = installMissingItems(mofo, { items: [
    { id: 'managed', name: '角色大调查', tagName: '柚月大调查', initialState: {} },
  ] });
  assert.equal(result.conflicts.length, 1);
  assert.equal(mofo.getItems().length, 1);
});

test('updates only the current-session runtime state of one item', () => {
  const mofo = fakeMofo([{ id: 'memory', name: '记忆', tagName: '记忆', htmlTemplate: '保持不变' }]);
  updateItemState(mofo, 'memory', { summary: '新的总结' }, 'read-only-test');
  const item = mofo.getItemById('memory');
  assert.equal(item.htmlTemplate, '保持不变');
  assert.equal(item.state.summary, '新的总结');
  assert.equal(item.lastUpdatedBy, 'read-only-test');
});

test('upgrades only the explicitly managed item and preserves its legacy state in place', () => {
  const mofo = fakeMofo([
    { id: 'yssa_investigation_report', name: '角色大调查', state: { target: '林姐', profile: '旧人物侧写' } },
    { id: 'user-item', name: '用户页面', htmlTemplate: '不要修改', state: { value: 1 } },
  ]);
  const pack = { items: [{
    id: 'yssa_investigation_report',
    name: '角色大调查',
    htmlTemplate: '<section>{{orientation}}</section>',
    promptTemplate: '新版提示词',
    initialState: { target: '未选择', orientation: '等待生成', bodyData: '等待生成', userNote: '等待生成' },
  }] };
  const upgraded = upgradeManagedItems(mofo, pack, ['yssa_investigation_report']);
  assert.deepEqual(upgraded, ['yssa_investigation_report']);
  const investigation = mofo.getItemById('yssa_investigation_report');
  assert.equal(investigation.htmlTemplate, '<section>{{orientation}}</section>');
  assert.equal(investigation.state.target, '林姐');
  assert.equal(investigation.state.profile, '旧人物侧写');
  assert.equal(mofo.getItemById('user-item').htmlTemplate, '不要修改');
});
