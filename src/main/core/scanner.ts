import * as dns from "dns";
import {
  carregarUsuariosRemotos,
  obterMacArp,
  obterFabricante,
  obterHostnameNbt,
  obterSerialRemoto,
  obterVersaoArquivo,
  pingHost
} from "./net";
import {
  obterCaminhoRustdesk,
  obterUltimaVersaoRepositorio,
  verificarConfiguracaoRustdesk
} from "./rustdesk";
import { emitir } from "./events";
import { Dispositivo, dispositivoVazio } from "../../shared";export interface ScannerOpcoes {
  modo: "cidr" | "faixa";
  ipBase?: string;
  cidr?: number;
  inicio?: string;
  fim?: string;
  colunas: string[];
}

export interface ScannerAlvos {
  ips: string[] | null;
  erro: string | null;
}

function ipParaInteiro(ip: string): number {
  const partes = ip.split(".").map((p) => parseInt(p, 10));
  return ((partes[0] << 24) >>> 0) + (partes[1] << 16) + (partes[2] << 8) + partes[3];
}

function inteiroParaIp(n: number): string {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
}

/** Equivalente ao scanner_montar_alvos (CIDR ou Faixa de IP, limite 4096). */
export function montarAlvos(opcoes: ScannerOpcoes): ScannerAlvos {
  try {
    if (opcoes.modo === "faixa") {
      const inicioStr = (opcoes.inicio || "").trim();
      const fimStr = (opcoes.fim || "").trim();
      if (!validarIp(inicioStr) || !validarIp(fimStr)) {
        return { ips: null, erro: "Preencha os campos com IPs válidos no formato x.x.x.x." };
      }
      const inicio = ipParaInteiro(inicioStr);
      const fim = ipParaInteiro(fimStr);
      if (fim < inicio) {
        return { ips: null, erro: "O IP final deve ser maior ou igual ao IP inicial." };
      }
      if (fim - inicio + 1 > 4096) {
        return { ips: null, erro: "Faixa muito grande. Limite de 4096 IPs por varredura." };
      }
      const ips: string[] = [];
      for (let i = inicio; i <= fim; i++) ips.push(inteiroParaIp(i));
      return { ips, erro: null };
    }

    const base = (opcoes.ipBase || "").trim();
    if (!validarIp(base)) {
      return { ips: null, erro: "Preencha os campos com IPs válidos no formato x.x.x.x." };
    }
    const cidr = opcoes.cidr ?? 24;
    if (cidr < 0 || cidr > 32) {
      return { ips: null, erro: "Máscara CIDR inválida." };
    }
    const mascara = cidr === 0 ? 0 : (0xffffffff << (32 - cidr)) >>> 0;
    const endereco = ipParaInteiro(base);
    const rede = (endereco & mascara) >>> 0;
    const total = 2 ** (32 - cidr);
    if (total > 4096) {
      return { ips: null, erro: "Rede muito grande. Limite de 4096 IPs por varredura." };
    }
    const ips: string[] = [];
    // hosts válidos (exclui rede e broadcast) quando possível
    const primeiro = cidr <= 30 ? rede + 1 : rede;
    const ultimo = cidr <= 30 ? rede + total - 2 : rede + total - 1;
    for (let i = primeiro; i <= ultimo; i++) ips.push(inteiroParaIp(i));
    if (!ips.length) ips.push(inteiroParaIp(rede));
    return { ips, erro: null };
  } catch {
    return { ips: null, erro: "Preencha os campos com IPs válidos no formato x.x.x.x." };
  }
}

function validarIp(valor: string): boolean {
  const partes = valor.split(".");
  if (partes.length !== 4) return false;
  return partes.every((p) => /^\d{1,3}$/.test(p) && parseInt(p, 10) <= 255);
}

interface Sessao {
  cancelar: boolean;
  emExecucao: boolean;
}

const sessao: Sessao = { cancelar: false, emExecucao: false };

export function scannerCancelar(): void {
  sessao.cancelar = true;
}

export function scannerEmExecucao(): boolean {
  return sessao.emExecucao;
}

async function mapearComLimite<T, R>(
  itens: T[],
  limite: number,
  fn: (item: T) => Promise<R>,
  aoConcluir?: (resultado: R, item: T) => void
): Promise<void> {
  let indice = 0;
  const workers: Promise<void>[] = [];
  for (let w = 0; w < Math.min(limite, itens.length); w++) {
    workers.push(
      (async () => {
        while (true) {
          const atual = indice++;
          if (atual >= itens.length) return;
          const resultado = await fn(itens[atual]);
          if (aoConcluir) aoConcluir(resultado, itens[atual]);
        }
      })()
    );
  }
  await Promise.all(workers);
}

/** Equivalente ao scanner_varrer_ip: ping + MAC/fabricante via ARP. */
async function varrerIp(ip: string, colunas: Set<string>): Promise<Dispositivo> {
  const { online, tempo } = await pingHost(ip);
  const item = dispositivoVazio(ip, online);
  item.tempo = online && tempo !== null ? `${tempo} ms` : "-";

  if (online && (colunas.has("mac") || colunas.has("fabricante"))) {
    const mac = await obterMacArp(ip);
    if (mac) {
      item.mac = mac;
      item.fabricante = obterFabricante(mac);
    }
  }

  return item;
}

/** Equivalente ao scanner_coletar_info: dados detalhados dos hosts online. */
async function coletarInfo(
  ip: string,
  base: Dispositivo,
  colunas: Set<string>,
  ultimaVersao: string | null
): Promise<Partial<Dispositivo>> {
  const info: Partial<Dispositivo> = { ...base };
  if (info.status !== "Online") return info;

  if (colunas.has("hostname") && info.hostname === "-") {
    try {
      const nomes = await dns.promises.reverse(ip);
      if (nomes.length) info.hostname = nomes[0].split(".")[0].toUpperCase();
    } catch {
      const nbt = await obterHostnameNbt(ip);
      if (nbt) info.hostname = nbt;
    }
  }

  const precisaRustdesk = ["rustdesk", "configurado", "versao", "atualizacao"].some((c) =>
    colunas.has(c)
  );

  if (precisaRustdesk) {
    const caminho = await obterCaminhoRustdesk(ip);

    if (caminho) {
      info.rustdesk = "Sim";

      if (colunas.has("configurado")) {
        info.configurado = (await verificarConfiguracaoRustdesk(ip)) ? "Sim" : "Não";
      }

      let versao: string | undefined;
      if (colunas.has("versao")) {
        versao = await obterVersaoArquivo(caminho);
        info.versao = versao;
      }

      if (colunas.has("atualizacao")) {
        info.atualizacao = statusAtualizacao(versao ?? "-", ultimaVersao);
      }
    } else {
      info.rustdesk = "Não";
      info.configurado = "-";
      info.versao = "-";
      info.atualizacao = "-";
    }
  }

  if (colunas.has("usuarios")) {
    try {
      const usuarios = await carregarUsuariosRemotos(ip);
      info.usuarios = String(usuarios.length);
    } catch {
      info.usuarios = "0";
    }
  }

  if (colunas.has("serial")) {
    const serial = await obterSerialRemoto(ip);
    info.serial = serial && serial !== "-" ? serial : "N/A";
  }

  return info;
}

/** Equivalente ao scanner_status_atualizacao. */
function statusAtualizacao(versao: string, ultimaVersao: string | null): string {
  if (!ultimaVersao || !versao || versao === "-") return "-";
  const m = String(ultimaVersao).match(/(\d+(?:\.\d+)+)/);
  const versaoRepositorio = m ? m[1] : "";
  if (versaoRepositorio && versao.startsWith(versaoRepositorio)) return "Não";
  if (versaoRepositorio) return `Sim (${versaoRepositorio})`;
  return "-";
}

/**
 * Equivalente ao scanner_thread: varredura em 2 fases
 * (ping com 60 threads -> detalhes com 8 threads).
 */
export async function scannerIniciar(opcoes: ScannerOpcoes, totalLog: (t: string) => void): Promise<void> {
  const alvos = montarAlvos(opcoes);
  if (alvos.erro || !alvos.ips) {
    emitir("evt:scanner:erro", { erro: alvos.erro });
    return;
  }

  const ips = alvos.ips;
  const colunas = new Set(opcoes.colunas);
  const total = ips.length;

  sessao.cancelar = false;
  sessao.emExecucao = true;

  const log = (t: string) => emitir("evt:log", { escopo: "scanner", texto: t, ts: Date.now() });

  const dados = new Map<string, Dispositivo>();

  try {
    log(`[SCANNER] Varredura iniciada: ${total} IPs (${opcoes.modo === "faixa" ? "Faixa de IP" : "CIDR"}).`);
    emitir("evt:scanner:limpar", {});
    emitir("evt:scanner:estado", { emExecucao: true });

    let feitos = 0;

    await mapearComLimite(
      ips,
      60,
      async (ip) => {
        if (sessao.cancelar) return dispositivoVazio(ip, false);
        try {
          return await varrerIp(ip, colunas);
        } catch {
          return dispositivoVazio(ip, false);
        }
      },
      (item, ip) => {
        if (sessao.cancelar) return;
        dados.set(ip, item);
        emitir("evt:scanner:dispositivo", { dispositivo: item });
        feitos++;
        emitir("evt:scanner:progresso", {
          fracao: 0.02 + (feitos / total) * 0.45,
          texto: `🔍 Varrendo... ${feitos}/${total}`
        });
      }
    );

    if (sessao.cancelar) return;

    emitir("evt:scanner:ordenar", {});

    const online = [...dados.values()].filter((d) => d.status === "Online").map((d) => d.ip);

    log(`[SCANNER] ${online.length} host(s) online de ${total}.`);

    if (online.length && !sessao.cancelar) {
      const ultimaVersao = await obterUltimaVersaoRepositorio(log);
      let detalhados = 0;

      await mapearComLimite(
        online,
        8,
        async (ip) => {
          if (sessao.cancelar) return {};
          const base = dados.get(ip);
          if (!base) return {};
          try {
            return await coletarInfo(ip, { ...base }, colunas, ultimaVersao);
          } catch {
            return {};
          }
        },
        (info, ip) => {
          if (sessao.cancelar) return;
          const atual = dados.get(ip);
          if (atual) Object.assign(atual, info);
          emitir("evt:scanner:atualizar", { ip, info });
          detalhados++;
          emitir("evt:scanner:progresso", {
            fracao: 0.5 + (detalhados / online.length) * 0.48,
            texto: `🖥 Coletando informações... ${detalhados}/${online.length}`
          });
        }
      );
    }

    if (sessao.cancelar) return;

    emitir("evt:scanner:progresso", { fracao: 1, texto: "✅ Varredura concluída!" });
    log("[SCANNER] Varredura concluída.");
  } finally {
    const cancelado = sessao.cancelar;
    sessao.emExecucao = false;
    emitir("evt:scanner:finalizado", { cancelado });
    emitir("evt:scanner:estado", { emExecucao: false });
  }
}
