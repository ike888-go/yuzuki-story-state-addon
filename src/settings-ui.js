const ROOT_ID = 'yssa-addon-settings';

function addTextElement(parent, tag, className, content) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = content;
  parent.appendChild(element);
  return element;
}

export class SettingsUI {
  constructor(runtime, openPhoneApp = () => {}) {
    this.runtime = runtime;
    this.openPhoneApp = openPhoneApp;
    this.root = null;
    this.statusNode = null;
    this.retryTimer = null;
    this.abortController = null;
  }

  start() {
    this.ensureRoot();
  }

  ensureRoot() {
    if (typeof document === 'undefined') return null;
    const existing = document.getElementById(ROOT_ID);
    if (existing) {
      this.root = existing;
      this.statusNode = existing.querySelector('[data-yssa-status]');
      return existing;
    }
    const container = document.querySelector('#extensions_settings2, #extensions_settings');
    if (!container) {
      if (!this.retryTimer) {
        this.retryTimer = globalThis.setTimeout?.(() => {
          this.retryTimer = null;
          this.ensureRoot();
        }, 1000);
      }
      return null;
    }

    this.abortController = new AbortController();
    const root = document.createElement('section');
    root.id = ROOT_ID;
    root.className = 'yssa-settings';
    root.setAttribute('aria-labelledby', 'yssa-addon-title');
    const heading = addTextElement(root, 'h3', '', '柚月魔坊内容增量包');
    heading.id = 'yssa-addon-title';
    addTextElement(root, 'p', 'yssa-settings__summary', '向柚月手机添加“剧情工坊”完整 App；只有手动点击生成时才调用 AI，不写数据库，也不启用 MVU。');
    this.statusNode = addTextElement(root, 'p', 'yssa-settings__status', '正在检测依赖…');
    this.statusNode.dataset.yssaStatus = '';
    this.statusNode.setAttribute('aria-live', 'polite');

    const actions = document.createElement('div');
    actions.className = 'yssa-settings__actions';
    const install = addTextElement(actions, 'button', 'menu_button', '安装缺失模板');
    install.type = 'button';
    install.addEventListener('click', () => this.runAction(() => this.runtime.installMissing('settings')), { signal: this.abortController.signal });
    const open = addTextElement(actions, 'button', 'menu_button', '打开剧情工坊');
    open.type = 'button';
    open.addEventListener('click', () => this.openPhoneApp(), { signal: this.abortController.signal });
    const refresh = addTextElement(actions, 'button', 'menu_button', '刷新记忆快照');
    refresh.type = 'button';
    refresh.addEventListener('click', () => this.runAction(() => this.runtime.refreshMemory('settings')), { signal: this.abortController.signal });
    const download = addTextElement(actions, 'button', 'menu_button', '下载魔坊导入包');
    download.type = 'button';
    download.addEventListener('click', () => this.downloadPack(), { signal: this.abortController.signal });
    root.appendChild(actions);
    container.appendChild(root);
    this.root = root;
    this.renderStatus(this.runtime.getStatus());
    return root;
  }

  async runAction(action) {
    try {
      await action();
    } catch (error) {
      this.notify(`操作失败：${error.message}`, 'error');
    }
  }

  renderStatus(status) {
    this.ensureRoot();
    if (!this.statusNode || !status) return;
    const capabilities = [
      `手机${status.phoneReady ? '已连接' : '未连接'}`,
      `魔坊${status.mofoReady ? '已连接' : '未连接'}`,
      `记忆${status.memoryReady ? '已连接' : '未连接'}`,
    ].join(' · ');
    this.statusNode.textContent = `${capabilities}｜${status.message || ''}${status.lastSync ? `｜最近同步 ${status.lastSync}` : ''}`;
  }

  async downloadPack() {
    try {
      const pack = await this.runtime.loadPack();
      const blob = new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = '柚月魔坊内容增量包.json';
      anchor.click();
      URL.revokeObjectURL(url);
      this.notify('魔坊导入包已下载。', 'success');
    } catch (error) {
      this.notify(`下载失败：${error.message}`, 'error');
    }
  }

  notify(message, type = 'info') {
    const toast = globalThis.toastr?.[type] || globalThis.toastr?.info;
    if (typeof toast === 'function') toast(message, '柚月魔坊内容增量包');
    else console.info(`[柚月魔坊内容增量包] ${message}`);
  }

  stop() {
    this.abortController?.abort();
    if (this.retryTimer) globalThis.clearTimeout?.(this.retryTimer);
    this.root?.remove();
    this.abortController = null;
    this.retryTimer = null;
    this.root = null;
    this.statusNode = null;
  }
}
