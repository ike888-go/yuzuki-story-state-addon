import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAmount, readWechatBalance, setWechatBalance } from '../src/wechat-wallet-adapter.js';

test('normalizes an editable WeChat balance to cents', () => {
  assert.equal(normalizeAmount('1,234.567'), 1234.57);
  assert.throws(() => normalizeAmount('-1'), /请输入/);
  assert.throws(() => normalizeAmount('not money'), /请输入/);
});

test('reads and writes the real Yuzuki WeChat wallet API', async () => {
  let balance = 18.5;
  const data = {
    getWalletBalance: () => balance,
    setWalletBalance: (value) => { balance = Number(value); },
  };
  const phone = { version: '1.5.2', cachedWechatData: data };
  assert.deepEqual(await readWechatBalance(phone), { initialized: true, balance: 18.5, phoneVersion: '1.5.2' });
  assert.equal(await setWechatBalance('88.88', phone), 88.88);
  assert.equal(balance, 88.88);
});
