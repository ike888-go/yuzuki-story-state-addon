import { StoryStateRuntime } from './src/runtime.js';
import { StoryStateUI } from './src/ui.js';

let runtime;
let ui;

function exposeApi() {
  globalThis.YuzukiStoryStateAddon = Object.freeze({
    version: '0.1.0',
    getState: () => runtime?.getState(),
    getMemoryProjection: () => runtime?.getMemoryProjection(),
    applyPatch: (patch, source) => runtime?.applyManualPatch(patch, source),
    importLegacy: (data) => runtime?.importLegacy(data),
    exportData: () => runtime?.exportData(),
    open: () => ui?.open(),
  });
}

export async function onActivate() {
  if (runtime) return;
  runtime = new StoryStateRuntime(() => ui?.rerender());
  await runtime.start();
  ui = new StoryStateUI(runtime);
  ui.start();
  exposeApi();
}

export async function onEnable() {
  await onActivate();
  await runtime.setSetting('enabled', true);
}

export async function onDisable() {
  if (!runtime) return;
  await runtime.setSetting('enabled', false);
  ui?.stop();
  runtime.stop();
  ui = null;
  runtime = null;
  delete globalThis.YuzukiStoryStateAddon;
}

export async function onClean() {
  await onDisable();
}
