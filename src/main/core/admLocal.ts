import fsp from "fs/promises";
import iconv from "iconv-lite";
import { runExe, sleep } from "./exec";
import { credObter } from "./credentials";
import {
  autenticarCompartilhamento,
  desconectarCompartilhamento,
  lerArquivoCp850,
  pingSimples
} from "./net";
import { logAuditoria } from "./events";
import { gerarBat, ADM_ACOES_TEXTO } from "../../shared";

const TAREFA_REMOTA = "GerenciarAdminLocal";
const COMPARTILHAMENTO = "C$";
const PASTA_REMOTA_TEMP = "C$\\Windows\\Temp";
const BAT_REMOTO = "C:\\Windows\\Temp\\exec_admin_task.bat";
const TIMEOUT_LOG = 30;

const MARCADORES =
  /PROCESSO_CONCLUIDO|SENHA_ALTERADA|EXCLUSAO_CONCLUIDA|CONSULTA_CONCLUIDA/;

export interface AdmOpcoes {
  acao: string;
  nomeUsuario: string;
  senhaUsuario: string;
  computadores: string[];
}

export interface AdmResultado {
  sucesso: boolean;
  processadas: number;
}

export interface AdmContexto {
  linha(texto: string): void;
  cancelado(): boolean;
}

function normalizarCredencial(usuario: string): string {
  if (!usuario) return usuario;
  if (!usuario.includes("\\")) return `REDEDOR\\${usuario}`;
  return usuario;
}

async function esperarLog(
  caminhoLog: string,
  cancelado: () => boolean
): Promise<string | null> {
  let porSegundo = 0;
  while (porSegundo < TIMEOUT_LOG) {
    if (cancelado()) return null;
    try {
      const conteudo = lerArquivoCp850(caminhoLog);
      if (conteudo && MARCADORES.test(conteudo)) return conteudo;
    } catch {
      /* arquivo ainda não existe */
    }
    await sleep(1000);
    porSegundo++;
  }
  try {
    const buf = await fsp.readFile(caminhoLog);
    return iconv.decode(buf, "cp850");
  } catch {
    return null;
  }
}

/** Equivalente ao executar_em_maquina do AdmLocal.py. */
async function executarEmMaquina(
  computador: string,
  conteudoBat: string,
  acaoTexto: string,
  ctx: AdmContexto
): Promise<boolean> {
  const { usuario, senha } = credObter();
  if (!usuario || !senha) {
    ctx.linha("[ERRO] Credenciais administrativas não configuradas.");
    return false;
  }
  const credUsuario = normalizarCredencial(usuario);

  const caminhoBat = `\\\\${computador}\\${PASTA_REMOTA_TEMP}\\exec_admin_task.bat`;
  const caminhoLog = `\\\\${computador}\\${PASTA_REMOTA_TEMP}\\resultado_admin.txt`;

  ctx.linha("-----------------------------------------------");
  ctx.linha(`[PING] Verificando se ${computador} esta online...`);

  if (ctx.cancelado()) return false;

  if (!(await pingSimples(computador))) {
    ctx.linha(
      `[ERRO] A maquina ${computador} esta desligada, fora da rede ou bloqueando ICMP.`
    );
    return false;
  }

  ctx.linha("[OK] Maquina online e respondendo.");
  ctx.linha("[INFO] Autenticando com as credenciais armazenadas...");

  if (!(await autenticarCompartilhamento(computador, COMPARTILHAMENTO))) {
    return false;
  }

  try {
    if (ctx.cancelado()) return false;

    try {
      await fsp.writeFile(caminhoLog, Buffer.alloc(0));
    } catch {
      /* ignora */
    }

    await fsp.writeFile(caminhoBat, iconv.encode(conteudoBat, "cp850"));

    ctx.linha(`[INFO] Iniciando ${acaoTexto} em ${computador}...`);

    const criacao = await runExe(
      "schtasks",
      [
        "/Create",
        "/S", computador,
        "/U", credUsuario,
        "/P", senha,
        "/TN", TAREFA_REMOTA,
        "/TR", `cmd.exe /d /c "${BAT_REMOTO}"`,
        "/SC", "ONCE",
        "/ST", "23:59",
        "/RU", "SYSTEM",
        "/RL", "HIGHEST",
        "/F"
      ],
      30000
    );

    if (criacao.code !== 0) {
      throw new Error(`Falha ao criar a tarefa agendada. Codigo: ${criacao.code}`);
    }

    const execucao = await runExe(
      "schtasks",
      ["/Run", "/S", computador, "/U", credUsuario, "/P", senha, "/TN", TAREFA_REMOTA],
      30000
    );

    if (execucao.code !== 0) {
      throw new Error(`Falha ao executar a tarefa agendada. Codigo: ${execucao.code}`);
    }

    const conteudo = await esperarLog(caminhoLog, ctx.cancelado);

    if (ctx.cancelado()) return false;

    if (conteudo) {
      ctx.linha("");
      ctx.linha(`==== RETORNO DE ${computador} ====`);
      for (const linha of conteudo.split(/\r?\n/)) ctx.linha(linha);
      ctx.linha("====================================");
      return true;
    }

    ctx.linha("[AVISO] O arquivo de log nao foi gerado no destino.");
    return false;
  } catch (erro) {
    ctx.linha(`[ERRO] ${erro instanceof Error ? erro.message : String(erro)}`);
    ctx.linha(
      `[AVISO] Confirme acesso administrativo a \\\\${computador}\\c$ e permissao para usar schtasks remoto.`
    );
    return false;
  } finally {
    await runExe(
      "schtasks",
      ["/Delete", "/S", computador, "/U", credUsuario, "/P", senha, "/TN", TAREFA_REMOTA, "/F"],
      30000
    );

    try {
      await fsp.unlink(caminhoBat);
    } catch {
      /* ignora */
    }

    await desconectarCompartilhamento(computador, COMPARTILHAMENTO);
  }
}

/** Equivalente ao executar do AdmLocal.py (todas as máquinas). */
export async function admExecutar(opcoes: AdmOpcoes, ctx: AdmContexto): Promise<AdmResultado> {
  const acaoTexto = `${ADM_ACOES_TEXTO[opcoes.acao]} ${opcoes.nomeUsuario}`;
  const conteudoBat = gerarBat(opcoes.acao, opcoes.nomeUsuario, opcoes.senhaUsuario);

  logAuditoria(
    `ADM Local | ${opcoes.acao} | usuario: ${opcoes.nomeUsuario} | maquinas: ${opcoes.computadores.join(", ")}`
  );

  let sucesso = true;
  let processadas = 0;

  for (const computador of opcoes.computadores) {
    if (ctx.cancelado()) break;

    const ok = await executarEmMaquina(computador, conteudoBat, acaoTexto, ctx);
    processadas++;
    if (!ok) sucesso = false;
  }

  return { sucesso, processadas };
}

/** Verifica se o .bat pode ser gravado (uso futuro / diagnóstico). */
export async function testeAcessoTemp(computador: string): Promise<boolean> {
  try {
    await fsp.access(`\\\\${computador}\\${PASTA_REMOTA_TEMP}`);
    return true;
  } catch {
    return false;
  }
}
