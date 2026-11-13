import { contextBridge, ipcRenderer, IpcRendererEvent } from "electron";

function on(canal: string, callback: (payload: unknown) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: unknown) => callback(payload);
  ipcRenderer.on(canal, listener);
  return () => {
    ipcRenderer.removeListener(canal, listener);
  };
}

const api = {
  invoke: (canal: string, ...args: unknown[]): Promise<unknown> =>
    ipcRenderer.invoke(canal, ...args),
  on
};

contextBridge.exposeInMainWorld("api", api);

export type ApiBridge = typeof api;
