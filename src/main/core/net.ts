import * as dns from "dns";
import * as fs from "fs";
import fsp from "fs/promises";
import iconv from "iconv-lite";
import { credObter } from "./credentials";
import { runCmd, runExe } from "./exec";
import { OUI_FABRICANTES } from "../../shared";

export interface PingResultado {
  online: boolean;
  tempo: number | null;
}

/** Equivalente ao scanner_ping: 1 pacote ICMP com 1,2s de timeout. */
export async function pingHost(host: string): Promise<PingResultado> {
  try {
    const r = await runExe("ping", ["-n", "1", "-w", "1200", host], 10000);
    if (r.code !== 0) return { online: false, tempo: null };
    const m = r.stdout.match(/(?:tempo|time)[=<]\s*(\d+)\s*ms/i);
    return { online: true, tempo: m ? parseInt(m[1], 10) : null };
  } catch {
    return { online: false, tempo: null };
  }
}

/** Equivalente a ping de verificação simples (apenas online/offline). */
export async function pingSimples(host: string): Promise<boolean> {
  try {
    const r = await runExe("ping", ["-n", "1", host], 10000);
    return r.code === 0;
  } catch {
    return false;
  }
}

/** Equivalente ao obter_mac_arp. */
export async function obterMacArp(ip: string): Promise<string | null> {
  try {
    const r = await runCmd(`arp -a ${ip}`);
    const m = r.stdout.match(/([0-9A-Fa-f]{2}-){5}[0-9A-Fa-f]{2}/);
    return m ? m[0].toUpperCase() : null;
  } catch {
    return null;
  }
}

/** Equivalente ao obter_fabricante. */
export function obterFabricante(mac: string | null): string {
  if (!mac) return "-";
  const prefixo = mac.split("-").slice(0, 3).join(":").toUpperCase();
  return OUI_FABRICANTES[prefixo] || "-";
}

/** Equivalente ao obter_hostname_nbt (nbtstat). */
export async function obterHostnameNbt(ip: string): Promise<string | null> {
  try {
    const r = await runCmd(`nbtstat -A ${ip}`);
    for (const linhaBruta of r.stdout.split("\n")) {
      const linha = linhaBruta.trim();
      if (linha.includes("<00>") && linha.toUpperCase().includes("UNIQUE")) {
        const partes = linha.split(/\s+/);
        if (partes.length && partes[0]) return partes[0].toUpperCase();
      }
    }
  } catch {
    /* ignora */
  }
  return null;
}

/** Equivalente ao obter_hostname_e_ip (resolve hostname <-> IP). */
export async function resolveHost(valor: string): Promise<{ hostname: string; ip: string }> {
  try {
    const partes = valor.split(".");
    const ehIp = partes.length === 4 && partes.every((p) => /^\d+$/.test(p));
    if (ehIp) {
      const nomes = await dns.promises.reverse(valor);
      return { hostname: nomes[0] || valor, ip: valor };
    }
    const res = await dns.promises.lookup(valor);
    return { hostname: valor, ip: res.address };
  } catch {
    return { hostname: valor, ip: "-" };
  }
}

const USUARIOS_IGNORADOS = new Set([
  "public",
  "default",
  "default user",
  "all users",
  "todos os usuários",
  "desktop.ini",
  "usuário padrão",
  "defaultuser0"
]);

/** Equivalente ao carregar_usuarios_remotos: lista perfis em \\host\c$\Users. */
export async function carregarUsuariosRemotos(hostname: string, log?: (t: string) => void): Promise<string[]> {
  const usuarios: string[] = [];
  const { usuario, senha } = credObter();

  if (!usuario || !senha) {
    if (log) log("[ERRO] Credenciais administrativas não configuradas.");
    return usuarios;
  }

  try {
    await runCmd(`net use \\\\${hostname}\\ipc$ "${senha}" /user:"${usuario}" > nul 2>&1`);

    const pasta = `\\\\${hostname}\\c$\\Users`;
    const entradas = await fsp.readdir(pasta, { withFileTypes: true });

    for (const entrada of entradas) {
      const nome = entrada.name;
      if (USUARIOS_IGNORADOS.has(nome.toLowerCase())) continue;
      if (!entrada.isDirectory()) continue;
      usuarios.push(nome);
    }
  } catch (erro) {
    if (log) log(`[ERRO] ${erro instanceof Error ? erro.message : String(erro)}`);
  } finally {
    await runCmd(`net use \\\\${hostname}\\ipc$ /delete /y > nul 2>&1`);
  }

  return usuarios;
}

/** Equivalente ao obter_serial_remoto (wmic -> PowerShell CIM). */
export async function obterSerialRemoto(host: string, log?: (t: string) => void): Promise<string> {
  const { usuario, senha } = credObter();
  if (!usuario || !senha) return "-";

  let credUsuario = usuario;
  if (!credUsuario.includes("\\")) credUsuario = `REDEDOR\\${credUsuario}`;

  try {
    const r = await runExe(
      "wmic",
      [
        `/node:${host}`,
        `/user:${credUsuario}`,
        `/password:${senha}`,
        "bios",
        "get",
        "serialnumber"
      ],
      20000
    );

    if (r.code === 0) {
      const linhas = r.stdout
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      if (linhas.length >= 2 && linhas[1]) return linhas[1];
    }
  } catch {
    /* tenta fallback */
  }

  try {
    const comando =
      `$c = New-Object System.Management.Automation.PSCredential('${credUsuario}',` +
      `(ConvertTo-SecureString '${senha}' -AsPlainText -Force)); ` +
      `(Get-CimInstance Win32_BIOS -ComputerName ${host} -Credential $c).SerialNumber`;
    const r = await runCmd(`powershell -NoProfile -Command "${comando}"`, 25000);
    const valor = r.stdout.trim();
    if (valor) return valor;
  } catch {
    /* ignora */
  }

  if (log) log(`[AVISO] Não foi possível obter o número de série de ${host}.`);
  return "-";
}

/** Equivalente ao verificar_servico_rustdesk: sc \\host query rustdesk. */
export async function servicoRustdeskExiste(hostname: string): Promise<boolean> {
  const r = await runCmd(`sc \\\\${hostname} query rustdesk > nul 2>&1`);
  return r.code === 0;
}

/** Autentica um compartilhamento UNC com as credenciais armazenadas. */
export async function autenticarCompartilhamento(
  computador: string,
  compartilhamento: string,
  log?: (t: string) => void
): Promise<boolean> {
  const { usuario, senha } = credObter();
  if (!usuario || !senha) {
    if (log) log("[ERRO] Credenciais administrativas não configuradas.");
    return false;
  }
  const alvo = `\\\\${computador}\\${compartilhamento}`;
  await runCmd(`net use ${alvo} /delete /y`);
  const r = await runCmd(`net use ${alvo} "${senha}" /user:"${usuario}" /persistent:no`);
  if (r.code !== 0) {
    if (log) {
      const saida = (r.stdout + " " + r.stderr).trim();
      log(`[ERRO] Falha na autenticação com as credenciais armazenadas. ${saida}`);
    }
    return false;
  }
  return true;
}

export async function desconectarCompartilhamento(computador: string, compartilhamento: string): Promise<void> {
  await runCmd(`net use \\\\${computador}\\${compartilhamento} /delete /y`);
}

/** Verifica existência de caminho (UNC incluído). */
export async function caminhoExiste(caminhoUnc: string): Promise<boolean> {
  try {
    await fsp.access(caminhoUnc);
    return true;
  } catch {
    return false;
  }
}

/** Equivalente ao obter_versao_arquivo (win32api GetFileVersionInfo). */
export async function obterVersaoArquivo(caminhoUnc: string): Promise<string> {
  try {
    const r = await runCmd(
      `powershell -NoProfile -Command "(Get-Item -LiteralPath '${caminhoUnc.replace(/'/g, "''")}').VersionInfo.FileVersion"`,
      15000
    );
    const versao = r.stdout.trim();
    if (versao && /^\d/.test(versao)) return versao;
    return "-";
  } catch {
    return "-";
  }
}

/** Lê um arquivo remoto decodificando cp850 (logs .bat). */
export function lerArquivoCp850(caminhoUnc: string): string | null {
  try {
    const buf = fs.readFileSync(caminhoUnc);
    return iconv.decode(buf, "cp850");
  } catch {
    return null;
  }
}
