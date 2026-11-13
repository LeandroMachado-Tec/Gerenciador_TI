import { app, BrowserWindow, shell } from "electron";
import { join } from "path";
import { registrarHandlers } from "./ipc";
import { emitir } from "./core/events";

function criarJanela(): BrowserWindow {
  const janela = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 1100,
    minHeight: 760,
    show: false,
    backgroundColor: "#0B1220",
    title: "Gerenciador de TI — by Machado_Scripts",
    autoHideMenuBar: true,
    icon: join(__dirname, "../../resources/icon.ico"),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  });

  janela.once("ready-to-show", () => {
    janela.maximize();
    janela.show();
  });

  janela.webContents.setWindowOpenHandler((detalhes) => {
    void shell.openExternal(detalhes.url);
    return { action: "deny" };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void janela.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void janela.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return janela;
}

const travaInstanciaUnica = app.requestSingleInstanceLock();

if (!travaInstanciaUnica) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [janela] = BrowserWindow.getAllWindows();
    if (janela) {
      if (janela.isMinimized()) janela.restore();
      janela.focus();
    }
  });

  app.whenReady().then(() => {
    registrarHandlers();
    criarJanela();
    configurarAtualizacaoAutomatica();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) criarJanela();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}

/**
 * Atualização automática (electron-updater).
 * Configure a URL de publicação em package.json -> build.publish.
 * Enquanto nenhuma URL real estiver configurada, os erros são
 * silenciosos e registrados apenas no log da interface.
 */
function configurarAtualizacaoAutomatica(): void {
  if (!app.isPackaged) return;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { autoUpdater } = require("electron-updater");
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on("checking-for-update", () => {
      emitir("evt:update", { estado: "verificando" });
    });
    autoUpdater.on("update-available", (info: { version: string }) => {
      emitir("evt:update", { estado: "disponivel", versao: info.version });
    });
    autoUpdater.on("update-not-available", () => {
      emitir("evt:update", { estado: "atualizado" });
    });
    autoUpdater.on("download-progress", (progresso: { percent: number }) => {
      emitir("evt:update", { estado: "baixando", percentual: Math.round(progresso.percent) });
    });
    autoUpdater.on("update-downloaded", (info: { version: string }) => {
      emitir("evt:update", { estado: "baixado", versao: info.version });
    });
    autoUpdater.on("error", (erro: Error) => {
      emitir("evt:update", { estado: "erro", mensagem: String(erro?.message || erro) });
    });

    setTimeout(() => {
      autoUpdater.checkForUpdatesAndNotify().catch(() => undefined);
    }, 5000);

    // Canal para verificação manual (botão "Verificar atualizações")
    const { ipcMain } = require("electron");
    ipcMain.handle("app:atualizacaoVerificar", async () => {
      try {
        await autoUpdater.checkForUpdatesAndNotify();
        return true;
      } catch (erro) {
        return String(erro instanceof Error ? erro.message : erro);
      }
    });
    ipcMain.handle("app:atualizacaoInstalar", () => {
      autoUpdater.quitAndInstall();
    });
  } catch {
    /* electron-updater indisponível */
  }
}
