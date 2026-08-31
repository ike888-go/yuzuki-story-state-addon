import { ContentAddonRuntime } from './src/runtime.js';
import { SettingsUI } from './src/settings-ui.js';

const VERSION = '0.2.0';

let runtime = null;
let settingsUI = null;

function exposeApi() {
  globalThis.YuzukiStoryStateAddon = Object.freeze({
    version: VERSION,
    getStatus: () => runtime?.getStatus() || null,
    installMissing: () => runtime?.installMissing('public-api'),
    refreshMemory: () => runtime?.refreshMemory('public-api'),
    getImportPack: () => runtime?.getImportPack() || null,
    downloadImportPack: () => settingsUI?.downloadPack(),
  });
}

export function onActivate() {
  if (runtime) return;
  runtime = new ContentAddonRuntime((status) => settingsUI?.renderStatus(status));
  settingsUI = new SettingsUI(runtime);
  settingsUI.start();
  exposeApi();
  runtime.start().catch((error) => {
    console.error('[柚月魔坊内容增量包] 启动失败', error);
  });
}

export function onEnable() {
  onActivate();
}

export function onDisable() {
  runtime?.stop();
  settingsUI?.stop();
  settingsUI = null;
  runtime = null;
  delete globalThis.YuzukiStoryStateAddon;
}

export function onClean() {
  onDisable();
}
