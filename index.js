import { ContentAddonRuntime } from './src/runtime.js';
import { SettingsUI } from './src/settings-ui.js';
import { StoryStudioPhoneApp, openStoryStudioApp } from './src/phone-studio-app.js';

const VERSION = '0.4.0';

let runtime = null;
let settingsUI = null;
let phoneApp = null;

function exposeApi() {
  globalThis.YuzukiStoryStateAddon = Object.freeze({
    version: VERSION,
    getStatus: () => runtime?.getStatus() || null,
    installMissing: () => runtime?.installMissing('public-api'),
    refreshMemory: () => runtime?.refreshMemory('public-api'),
    getImportPack: () => runtime?.getImportPack() || null,
    downloadImportPack: () => settingsUI?.downloadPack(),
    openStudio: () => openStoryStudioApp(),
    generate: (toolId, options) => runtime?.generateTool(toolId, options),
    cancelGeneration: () => runtime?.cancelGeneration(),
  });
}

export function onActivate() {
  if (runtime) return;
  runtime = new ContentAddonRuntime((status) => {
    settingsUI?.renderStatus(status);
    phoneApp?.onRuntimeStatus(status);
  });
  phoneApp = new StoryStudioPhoneApp(runtime);
  settingsUI = new SettingsUI(runtime, (view) => phoneApp?.openFromSettings(view));
  settingsUI.start();
  phoneApp.start();
  exposeApi();
  runtime.start().catch((error) => {
    console.error('[柚月魔坊内容增量包] 启动失败', error);
  });
}

export function onEnable() {
  onActivate();
}

export function onDisable() {
  phoneApp?.stop();
  runtime?.stop();
  settingsUI?.stop();
  settingsUI = null;
  phoneApp = null;
  runtime = null;
  delete globalThis.YuzukiStoryStateAddon;
}

export function onClean() {
  onDisable();
}
