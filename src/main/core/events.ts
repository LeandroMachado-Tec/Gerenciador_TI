import { BrowserWindow } from "electron";

export type EscopoEvento = "rustdesk" | "scanner" | "adm" | "app";

export interface Emissor {
  log(texto: string): void;
  progresso(fracao: number, texto?: string): void;
}

function janela(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows()[0];
}

export function emitir(canal: string, payload: unknown): void {
  try {
    janela()?.webContents.send(canal, payload);
  } catch {
    /* janela fechada */
  }
}

export function criarEmissor(escopo: EscopoEvento): Emissor {
  return {
    log(texto) {
      emitir("evt:log", { escopo, texto, ts: Date.now() });
    },
    progresso(fracao, texto) {
      emitir("evt:progresso", { escopo, fracao, texto });
    }
  };
}

/** Equivalente ao LOG_AUDITORIA do Python (userData/auditoria.log). */
export function logAuditoria(linha: string): void {
  try {
    const fs = require("fs") as typeof import("fs");
    const path = require("path") as typeof import("path");
    const { app } = require("electron") as typeof import("electron");
    const arquivo = path.join(app.getPath("userData"), "auditoria.log");
    fs.appendFileSync(arquivo, `${new Date().toISOString()} | ${linha}\n`, "utf8");
  } catch {
    /* ignora */
  }
}
