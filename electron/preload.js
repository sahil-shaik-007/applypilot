const { contextBridge, ipcRenderer, webUtils } = require('electron');

const listeners = new Set();
ipcRenderer.on('event', (_e, msg) => listeners.forEach((fn) => { try { fn(msg.channel, msg.payload); } catch {} }));

contextBridge.exposeInMainWorld('api', {
  // Every call resolves to data or throws with a readable message.
  call: async (channel, ...args) => {
    const r = await ipcRenderer.invoke(channel, ...args);
    if (!r.ok) throw new Error(r.error);
    return r.data;
  },
  on: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch { return null; } },
  // Ask the main process to re-check that the window fits the screen's usable area.
  fitWindow: () => ipcRenderer.invoke('window:fit').catch(() => {}),
});
