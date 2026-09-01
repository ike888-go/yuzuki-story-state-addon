const MAX_BALANCE = 999999999.99;

function normalizeAmount(value) {
  const amount = Number.parseFloat(String(value ?? '').replace(/,/g, '').trim());
  if (!Number.isFinite(amount) || amount < 0 || amount > MAX_BALANCE) {
    throw new Error(`请输入 0 到 ${MAX_BALANCE.toFixed(2)} 之间的金额。`);
  }
  return Math.round(amount * 100) / 100;
}

function hasWalletApi(value) {
  return Boolean(value)
    && typeof value.getWalletBalance === 'function'
    && typeof value.setWalletBalance === 'function';
}

export async function resolveWechatData(phone = globalThis.VirtualPhone) {
  if (hasWalletApi(phone?.wechatApp?.wechatData)) return phone.wechatApp.wechatData;
  if (hasWalletApi(phone?.cachedWechatData)) return phone.cachedWechatData;
  if (!phone?.extensionBaseUrl || !phone?.storage) {
    throw new Error('柚月微信数据尚未就绪，请先打开一次柚月手机。');
  }

  const moduleUrl = new URL('apps/wechat/wechat-data.js', phone.extensionBaseUrl);
  moduleUrl.searchParams.set('yssa_wallet', String(phone.version || Date.now()));
  const module = await import(moduleUrl.href);
  if (typeof module.WechatData !== 'function') throw new Error('当前柚月手机版本没有可用的微信数据接口。');
  const data = new module.WechatData(phone.storage);
  if (!hasWalletApi(data)) throw new Error('当前柚月手机版本不支持修改微信余额。');
  phone.cachedWechatData = data;
  if (phone.wechatApp) phone.wechatApp.wechatData = data;
  return data;
}

export async function readWechatBalance(phone = globalThis.VirtualPhone) {
  const data = await resolveWechatData(phone);
  const raw = data.getWalletBalance(null);
  const value = Number.parseFloat(raw);
  return {
    initialized: Number.isFinite(value),
    balance: Number.isFinite(value) ? Math.round(value * 100) / 100 : 0,
    phoneVersion: String(phone?.version || '未知'),
  };
}

export async function setWechatBalance(value, phone = globalThis.VirtualPhone) {
  const amount = normalizeAmount(value);
  const data = await resolveWechatData(phone);
  await data.setWalletBalance(amount, null);
  const saved = Number.parseFloat(data.getWalletBalance(null));
  if (!Number.isFinite(saved) || Math.abs(saved - amount) > 0.001) throw new Error('余额已提交，但读取校验失败。');
  return Math.round(saved * 100) / 100;
}

export { MAX_BALANCE, normalizeAmount };
