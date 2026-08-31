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
    const heading = addTextElement(root, 'h3', '', '柚月剧情工坊');
    heading.id = 'yssa-addon-title';
    addTextElement(root, 'p', 'yssa-settings__summary', '向柚月手机添加独立原生 App；内容按当前聊天保存在本扩展中，不使用数据库、MVU或魔坊。');
    this.statusNode = addTextElement(root, 'p', 'yssa-settings__status', '正在检测依赖…');
    this.statusNode.dataset.yssaStatus = '';
    this.statusNode.setAttribute('aria-live', 'polite');

    const actions = document.createElement('div');
    actions.className = 'yssa-settings__actions';
    const open = addTextElement(actions, 'button', 'menu_button', '打开剧情工坊');
    open.type = 'button';
    open.addEventListener('click', () => this.openPhoneApp(), { signal: this.abortController.signal });
    const prompts = addTextElement(actions, 'button', 'menu_button', '编辑生成提示词');
    prompts.type = 'button';
    prompts.addEventListener('click', () => this.openPhoneApp('prompt-settings'), { signal: this.abortController.signal });
    const refresh = addTextElement(actions, 'button', 'menu_button', '刷新柚月记忆');
    refresh.type = 'button';
    refresh.addEventListener('click', () => this.runAction(() => this.runtime.refreshMemory('settings')), { signal: this.abortController.signal });
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
      `原生状态${status.storageReady ? '已就绪' : '未就绪'}`,
      `记忆${status.memoryReady ? '已连接' : '未连接'}`,
    ].join(' · ');
    this.statusNode.textContent = `${capabilities}｜${status.message || ''}${status.lastSync ? `｜最近同步 ${status.lastSync}` : ''}`;
  }

  notify(message, type = 'info') {
    const toast = globalThis.toastr?.[type] || globalThis.toastr?.info;
    if (typeof toast === 'function') toast(message, '柚月剧情工坊');
    else console.info(`[柚月剧情工坊] ${message}`);
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
