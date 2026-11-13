import { ipcMain, dialog, clipboard, BrowserWindow, app } from "electron";
import { credObter, credRemover, credSalvar } from "./core/credentials";
import { validarCredencialAdm } from "./core/validation";
import { pingHost, resolveHost } from "./core/net";
import {
  configurarRustdesk,
  desinstalarRustdesk,
  instalarRustdesk,
  obterCaminhoRustdesk,
  obterUltimaVersaoRepositorio,
  atualizarRepositorio,
  verificarConfiguracaoRustdesk
} from "./core/rustdesk";
import {
  scannerCancelar,
  scannerEmExecucao,
  scannerIniciar,
  ScannerOpcoes
} from "./core/scanner";
import { admExecutar, AdmOpcoes } from "./core/admLocal";
import { carregarUsuariosRemotos } from "./core/net";
import { criarEmissor, emitir } from "./core/events";
import { obterVersaoArquivo } from "./core/net";
import fs from "fs";
import path from "path";

const CONFIRM_CHANNEL = "evt:confirmar";
let pendenteConfirmacao: ((valor: boolean) => void) | null = null;

/** Confirmação estilizada exibida na interface (equivalente ao perguntar). */
function confirmar(titulo: string, mensagem: string): Promise<boolean> {
  return new Promise((resolve) => {
    pendenteConfirmacao = resolve;
    emitir(CONFIRM_CHANNEL, { titulo, mensagem });
  });
}

function caminhoColunas(): string {
  return path.join(app.getPath("userData"), "scanner_config.json");
}

export function registrarHandlers(): void {
  // ------------------------- Aplicação -------------------------
  ipcMain.handle("app:info", () => {
    const os = require("os") as typeof import("os");
    let ipLocal = "";
    for (const interfaces of Object.values(os.networkInterfaces())) {
      for (const iface of interfaces || []) {
        if (iface.family === "IPv4" && !iface.internal) {
          ipLocal = iface.address;
          break;
        }
      }
      if (ipLocal) break;
    }
    return {
      versao: app.getVersion(),
      userData: app.getPath("userData"),
      auditoria: path.join(app.getPath("userData"), "auditoria.log"),
      hostname: process.env.COMPUTERNAME || "",
      ipLocal
    };
  });

  ipcMain.handle("app:copia", (_e, texto: string) => {
    clipboard.writeText(String(texto || ""));
    return true;
  });

  ipcMain.handle("app:confirmar-resposta", (_e, valor: boolean) => {
    if (pendenteConfirmacao) {
      pendenteConfirmacao(valor);
      pendenteConfirmacao = null;
    }
    return true;
  });

  // ------------------------- Credenciais -------------------------
  ipcMain.handle("cred:obter", () => credObter());

  ipcMain.handle("cred:salvar", (_e, usuario: string, senha: string) => {
    credSalvar(String(usuario || ""), String(senha || ""));
    return true;
  });

  ipcMain.handle("cred:remover", () => {
    credRemover();
    return true;
  });

  ipcMain.handle("cred:validar", () => validarCredencialAdm());

  // ------------------------- Rede -------------------------
  ipcMain.handle("net:ping", (_e, host: string) => pingHost(String(host || "")));

  ipcMain.handle("net:resolver", (_e, valor: string) => resolveHost(String(valor || "")));

  ipcMain.handle("net:usuarios", async (_e, hostname: string) =>
    carregarUsuariosRemotos(String(hostname || ""), (t) =>
      emitir("evt:log", { escopo: "rustdesk", texto: t, ts: Date.now() })
    )
  );

  // ------------------------- RustDesk -------------------------
  ipcMain.handle("rustdesk:verificar", async (_e, hostname: string) => {
    const host = String(hostname || "");
    const caminho = await obterCaminhoRustdesk(host);
    if (!caminho) {
      return { instalado: false, caminho: null, versao: "-", configurado: false };
    }
    const versao = await obterVersaoArquivo(caminho);
    const configurado = await verificarConfiguracaoRustdesk(host);
    return { instalado: true, caminho, versao, configurado };
  });

  ipcMain.handle("rustdesk:configurar", async (_e, payload: { hostname: string; senha: string }) => {
    const emissor = criarEmissor("rustdesk");
    return configurarRustdesk(
      String(payload.hostname || ""),
      String(payload.senha || ""),
      emissor.log,
      emissor.progresso
    );
  });

  ipcMain.handle("rustdesk:instalar", async (_e, payload: { hostname: string }) => {
    const emissor = criarEmissor("rustdesk");
    return instalarRustdesk(
      String(payload.hostname || ""),
      confirmar,
      emissor.log,
      emissor.progresso
    );
  });

  ipcMain.handle("rustdesk:desinstalar", async (_e, payload: { hostname: string }) => {
    const emissor = criarEmissor("rustdesk");
    return desinstalarRustdesk(String(payload.hostname || ""), emissor.log, emissor.progresso);
  });

  ipcMain.handle("rustdesk:versaoRepositorio", () => obterUltimaVersaoRepositorio());

  ipcMain.handle("rustdesk:atualizarRepositorio", async () => {
    const emissor = criarEmissor("rustdesk");
    await atualizarRepositorio(emissor.log);
    return true;
  });

  // ------------------------- IP Scanner -------------------------
  ipcMain.handle("scanner:iniciar", async (_e, opcoes: ScannerOpcoes) => {
    if (scannerEmExecucao()) return false;
    void scannerIniciar(opcoes, () => undefined);
    return true;
  });

  ipcMain.handle("scanner:cancelar", () => {
    scannerCancelar();
    return true;
  });

  ipcMain.handle("scanner:colunasObter", () => {
    const padrao = [
      "ip",
      "hostname",
      "mac",
      "fabricante",
      "status",
      "tempo",
      "rustdesk",
      "configurado",
      "versao",
      "atualizacao",
      "usuarios",
      "serial"
    ];
    try {
      const salvas = JSON.parse(fs.readFileSync(caminhoColunas(), "utf8"));
      if (Array.isArray(salvas)) {
        const filtradas = salvas.filter((c: string) => padrao.includes(c));
        for (const obrigatoria of ["ip", "hostname"]) {
          if (!filtradas.includes(obrigatoria)) filtradas.push(obrigatoria);
        }
        return filtradas;
      }
    } catch {
      /* usa padrão */
    }
    return padrao;
  });

  ipcMain.handle("scanner:colunasSalvar", (_e, colunas: string[]) => {
    try {
      fs.writeFileSync(caminhoColunas(), JSON.stringify(colunas), "utf8");
    } catch {
      /* ignora */
    }
    return true;
  });

  // ------------------------- ADM Local -------------------------
  let canceladoAdm = false;

  ipcMain.handle("adm:executar", async (_e, opcoes: AdmOpcoes) => {
    canceladoAdm = false;
    const ctx = {
      linha: (texto: string) => emitir("evt:adm:linha", { texto }),
      cancelado: () => canceladoAdm
    };

    const resultado = await admExecutar(opcoes, ctx);
    emitir("evt:adm:finalizado", resultado);
    return resultado;
  });

  ipcMain.handle("adm:cancelar", () => {
    canceladoAdm = true;
    return true;
  });

  // ------------------------- Diálogos nativos (fallback) -------------------------
  ipcMain.handle("dialog:mensagem", async (_e, opts: { titulo: string; mensagem: string; tipo?: "info" | "error" | "warning" }) => {
    const janela = BrowserWindow.getAllWindows()[0];
    if (janela) {
      await dialog.showMessageBox(janela, {
        type: opts.tipo || "info",
        title: opts.titulo,
        message: opts.mensagem,
        buttons: ["OK"]
      });
    }
    return true;
  });
}
