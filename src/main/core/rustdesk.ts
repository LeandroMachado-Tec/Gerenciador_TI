import fsp from "fs/promises";
import fs from "fs";
import path from "path";
import { credObter } from "./credentials";
import { runCmd, sleep } from "./exec";
import {
  caminhoExiste,
  carregarUsuariosRemotos,
  lerArquivoCp850,
  obterVersaoArquivo,
  servicoRustdeskExiste
} from "./net";
import { logAuditoria } from "./events";
import { REPO_RUSTDESK, RUSTDESK_KEY, SERVER_IP } from "../../shared";

export interface Emissor {
  log(texto: string): void;
  progresso(fracao: number, texto?: string): void;
}

export interface ResumoConfiguracao {
  hostname: string;
  total: number;
  sucesso: number;
  falha: number;
  senha: string;
  servidor: string;
}

export interface ResultadoConfiguracao {
  erro: "nao-instalado" | "sem-usuarios" | "sem-credenciais" | null;
  resumo: ResumoConfiguracao | null;
}

function defaultToml(): string {
  return "[options]\nview_style = 'adaptive'\n";
}

function tomlConfig(): string {
  return (
    `\nrendezvous_server = '${SERVER_IP}:21116'\n` +
    `nat_type = 1\n` +
    `serial = 0\n\n` +
    `[options]\n` +
    `allow-remote-config-modification = 'Y'\n` +
    `relay-server = '${SERVER_IP}'\n` +
    `allow-auto-update = 'Y'\n` +
    `key = '${RUSTDESK_KEY}'\n` +
    `custom-rendezvous-server = '${SERVER_IP}'\n` +
    `verification-method = 'use-permanent-password'\n` +
    `direct-server = 'Y'\n` +
    `direct-access-port = '21118'\n` +
    `enable-rdp = 'Y'\n`
  );
}

/**
 * Equivalente ao executar_tarefa_remota do gui.py:
 * cria e executa uma tarefa agendada remota (schtasks) como SYSTEM,
 * com gravação no log de auditoria.
 */
export async function executarTarefaRemota(
  hostname: string,
  nomeTarefa: string,
  comando: string,
  log: (t: string) => void
): Promise<boolean> {
  const { usuario, senha } = credObter();
  if (!usuario || !senha) {
    log("[ERRO] Credenciais administrativas não configuradas.");
    return false;
  }

  let credUsuario = usuario;
  if (!credUsuario.includes("\\")) credUsuario = `REDEDOR\\${credUsuario}`;

  logAuditoria(`${credUsuario} | ${hostname} | ${nomeTarefa}`);

  try {
    const criar = await runCmd(
      `schtasks /create /S ${hostname} /U "${credUsuario}" /P "${senha}" ` +
        `/TN "${nomeTarefa}" /TR "${comando}" /SC ONCE /ST 23:59 /RU SYSTEM /RL HIGHEST /F`,
      30000
    );

    log(`[SCHTASKS CREATE STDOUT] ${criar.stdout.trim()}`);
    log(`[SCHTASKS CREATE STDERR] ${criar.stderr.trim()}`);
    log(`[SCHTASKS CREATE] Retorno: ${criar.code}`);

    if (criar.code !== 0) {
      log("[ERRO] Falha ao criar tarefa remota.");
      return false;
    }

    const executar = await runCmd(
      `schtasks /run /S ${hostname} /U "${credUsuario}" /P "${senha}" /TN "${nomeTarefa}"`,
      30000
    );

    log(`[SCHTASKS RUN STDOUT] ${executar.stdout.trim()}`);
    log(`[SCHTASKS RUN STDERR] ${executar.stderr.trim()}`);

    const erroTexto = (executar.stdout + executar.stderr).toLowerCase();
    if (erroTexto.includes("credenciais do usuário não são permitidas")) {
      log("[ERRO] Usuário sem permissão para executar tarefas remotas.");
    }
    if (erroTexto.includes("access is denied") || erroTexto.includes("acesso negado")) {
      log("[ERRO] Acesso negado ao SchTasks remoto.");
    }

    log(`[SCHTASKS RUN] Retorno: ${executar.code}`);
    return executar.code === 0;
  } catch (erro) {
    log(`[ERRO] ${erro instanceof Error ? erro.message : String(erro)}`);
    return false;
  }
}

/** Equivalente ao obter_versao_rustdesk: localiza rustdesk.exe remoto. */
export async function obterCaminhoRustdesk(hostname: string): Promise<string | null> {
  const { usuario, senha } = credObter();
  if (!usuario || !senha) return null;

  try {
    await runCmd(`net use \\\\${hostname}\\ipc$ "${senha}" /user:"${usuario}" > nul 2>&1`);

    const caminhos = [
      `\\\\${hostname}\\c$\\Program Files\\RustDesk\\rustdesk.exe`,
      `\\\\${hostname}\\c$\\Program Files (x86)\\RustDesk\\rustdesk.exe`
    ];

    for (const caminho of caminhos) {
      if (await caminhoExiste(caminho)) return caminho;
    }
    return null;
  } finally {
    await runCmd(`net use \\\\${hostname}\\ipc$ /delete /y > nul 2>&1`);
  }
}

/** Equivalente ao verificar_configuracao_rustdesk. */
export async function verificarConfiguracaoRustdesk(hostname: string): Promise<boolean> {
  try {
    const caminho =
      `\\\\${hostname}\\c$\\Windows\\ServiceProfiles` +
      `\\LocalService\\AppData\\Roaming\\RustDesk\\config\\RustDesk2.toml`;

    if (!(await caminhoExiste(caminho))) return false;

    const conteudo = await fsp.readFile(caminho, "utf8");
    return conteudo.includes(SERVER_IP) && conteudo.includes(RUSTDESK_KEY);
  } catch {
    return false;
  }
}

/** Equivalente ao reiniciar_rustdesk (sc stop/start). */
export async function reiniciarRustdesk(hostname: string, log: (t: string) => void): Promise<void> {
  try {
    log("Parando serviço RustDesk...");
    const stop = await runCmd(`sc \\\\${hostname} stop rustdesk`);
    log(stop.code === 0 ? "[OK] Serviço parado" : "[ERRO] Falha ao parar serviço");

    await sleep(3000);

    log("Iniciando serviço RustDesk...");
    const start = await runCmd(`sc \\\\${hostname} start rustdesk`);
    log(start.code === 0 ? "[OK] Serviço iniciado" : "[ERRO] Falha ao iniciar serviço");
  } catch (erro) {
    log(`[ERRO] Serviço: ${erro instanceof Error ? erro.message : String(erro)}`);
  }
}

/** Equivalente ao aplicar_senha_rustdesk (tarefa RustDeskPwd_*). */
export async function aplicarSenhaRustdesk(
  hostname: string,
  senha: string,
  log: (t: string) => void
): Promise<void> {
  try {
    log(`[INFO] Aplicando senha para ${hostname}`);

    const sucesso = await executarTarefaRemota(
      hostname,
      `RustDeskPwd_${hostname}`,
      `C:\\Progra~1\\RustDesk\\RustDesk.exe --password ${senha}`,
      log
    );

    if (sucesso) {
      log("[OK] Senha aplicada");
      try {
        const retorno = await runCmd(
          `schtasks /delete /S ${hostname} /U "${credObter().usuario}" /P "${credObter().senha}" /TN "RustDeskPwd_${hostname}" /F`
        );
        log(`[LIMPEZA] Removendo tarefa RustDeskPwd_${hostname}`);
        log(`[LIMPEZA] Retorno: ${retorno.code}`);
      } catch (erro) {
        log(`[ERRO] Falha ao remover tarefa: ${erro instanceof Error ? erro.message : String(erro)}`);
      }
    } else {
      log("[ERRO] Senha não aplicada");
    }
  } catch (erro) {
    log(`[ERRO] Senha: ${erro instanceof Error ? erro.message : String(erro)}`);
  }
}

/** Equivalente ao configurar do rustdesk.py — fluxo completo. */
export async function configurarRustdesk(
  hostname: string,
  senhaRustdesk: string,
  log: (t: string) => void,
  progresso: (fracao: number, texto?: string) => void
): Promise<ResultadoConfiguracao> {
  const { usuario } = credObter();
  if (!usuario) {
    log("[ERRO] Credenciais administrativas não configuradas.");
    return { erro: "sem-credenciais", resumo: null };
  }

  const caminhoRustdesk = await obterCaminhoRustdesk(hostname);

  if (!caminhoRustdesk) {
    log("[ERRO] Tentativa de configurar RustDesk não instalado.");
    return { erro: "nao-instalado", resumo: null };
  }

  progresso(0, "Preparando configuração...");
  progresso(0, "Iniciando configuração...");

  const usuarios = await carregarUsuariosRemotos(hostname, log);
  const total = usuarios.length;

  if (total === 0) {
    return { erro: "sem-usuarios", resumo: null };
  }

  const sucesso: string[] = [];
  const falha: string[] = [];
  const toml = tomlConfig();
  const tomlDefault = defaultToml();

  for (let i = 0; i < total; i++) {
    const usuario = usuarios[i];
    try {
      const configDir =
        `\\\\${hostname}\\c$\\Users\\${usuario}` + `\\AppData\\Roaming\\RustDesk\\config`;

      await fsp.mkdir(configDir, { recursive: true });

      const arquivo = path.join(configDir, "RustDesk2.toml");
      await fsp.writeFile(arquivo, toml, "utf8");

      if (await caminhoExiste(arquivo)) {
        log(`[CONFIRMADO] TOML criado para ${usuario}`);
      } else {
        log(`[ERRO] TOML não encontrado para ${usuario}`);
      }

      const arquivoDefault = path.join(configDir, "RustDesk_default.toml");
      await fsp.writeFile(arquivoDefault, tomlDefault, "utf8");

      if (await caminhoExiste(arquivoDefault)) {
        log(`[CONFIRMADO] DEFAULT criado para ${usuario}`);
      } else {
        log(`[ERRO] DEFAULT não criado para ${usuario}`);
      }

      log(`[OK] ${usuario}`);
      sucesso.push(usuario);
    } catch (erro) {
      falha.push(usuario);
      log(`[ERRO] ${usuario}: ${erro instanceof Error ? erro.message : String(erro)}`);
    }

    progresso((i + 1) / total, `Configurando ${i + 1}/${total}`);
  }

  try {
    const localService =
      `\\\\${hostname}\\c$\\Windows\\ServiceProfiles` +
      `\\LocalService\\AppData\\Roaming\\RustDesk\\config`;

    await fsp.mkdir(localService, { recursive: true });

    const arquivoLocalService = path.join(localService, "RustDesk2.toml");
    await fsp.writeFile(arquivoLocalService, toml, "utf8");

    if (await caminhoExiste(arquivoLocalService)) {
      log("[CONFIRMADO] TOML criado para LocalService");
    } else {
      log("[ERRO] TOML não encontrado para LocalService");
    }

    const arquivoDefaultLocal = path.join(localService, "RustDesk_default.toml");
    await fsp.writeFile(arquivoDefaultLocal, tomlDefault, "utf8");

    if (await caminhoExiste(arquivoDefaultLocal)) {
      log("[CONFIRMADO] DEFAULT criado para LocalService");
    } else {
      log("[ERRO] DEFAULT não criado para LocalService");
    }

    log("[OK] LocalService");
    sucesso.push("LocalService");
  } catch (erro) {
    falha.push("LocalService");
    log(`[ERRO] LocalService: ${erro instanceof Error ? erro.message : String(erro)}`);
  }

  await reiniciarRustdesk(hostname, log);
  await aplicarSenhaRustdesk(hostname, senhaRustdesk, log);

  log("Configuração concluída.");

  progresso(1, "✅ Configuração concluída");

  return {
    erro: null,
    resumo: {
      hostname,
      total,
      sucesso: sucesso.length,
      falha: falha.length,
      senha: senhaRustdesk,
      servidor: SERVER_IP
    }
  };
}

/** Equivalente ao extrair_versao. */
export function extrairVersao(nome: string): number[] {
  const m = nome.match(/(\d+(?:\.\d+)+)/);
  if (!m) return [0];
  return m[1].split(".").map((n) => parseInt(n, 10));
}

function compararVersoes(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const va = a[i] ?? 0;
    const vb = b[i] ?? 0;
    if (va !== vb) return va - vb;
  }
  return 0;
}

/** Equivalente ao localizar_instalador: seleciona a versão mais recente do repositório. */
export async function localizarInstalador(log: (t: string) => void): Promise<string | null> {
  try {
    const arquivos = (await fsp.readdir(REPO_RUSTDESK))
      .filter((a) => a.toLowerCase().startsWith("rustdesk") && a.toLowerCase().endsWith(".exe"))
      .sort((a, b) => compararVersoes(extrairVersao(b), extrairVersao(a)));

    if (!arquivos.length) {
      log("[ERRO] Nenhum instalador encontrado.");
      return null;
    }

    log("[REPOSITORIO] Versões encontradas:");
    for (const arquivo of arquivos) log(` - ${arquivo}`);
    log(`[REPOSITORIO] Versão selecionada: ${arquivos[0]}`);

    return path.join(REPO_RUSTDESK, arquivos[0]);
  } catch {
    log("[ERRO] Pasta do repositório não encontrada.");
    return null;
  }
}

/** Equivalente ao obter_ultima_versao_repositorio. */
export async function obterUltimaVersaoRepositorio(log?: (t: string) => void): Promise<string | null> {
  try {
    const arquivos = (await fsp.readdir(REPO_RUSTDESK))
      .filter((a) => a.toLowerCase().startsWith("rustdesk") && a.toLowerCase().endsWith(".exe"))
      .sort((a, b) => compararVersoes(extrairVersao(b), extrairVersao(a)));

    return arquivos.length ? arquivos[0] : null;
  } catch (erro) {
    if (log) log(`[ERRO] Repositório: ${erro instanceof Error ? erro.message : String(erro)}`);
    return null;
  }
}

/** Equivalente ao atualizar_repositorio: baixa a última release do GitHub. */
export async function atualizarRepositorio(log: (t: string) => void): Promise<void> {
  try {
    log("Atualizando repositório RustDesk...");

    await fsp.mkdir(REPO_RUSTDESK, { recursive: true });

    const url = "https://api.github.com/repos/rustdesk/rustdesk/releases";
    const resposta = await fetch(url, { signal: AbortSignal.timeout(30000) });
    const releases = (await resposta.json()) as Array<{
      prerelease: boolean;
      assets: Array<{ name: string; browser_download_url: string }>;
    }>;

    const release = releases.find((r) => !r.prerelease);

    if (!release) {
      log("[ERRO] Nenhuma release encontrada.");
      return;
    }

    for (const asset of release.assets) {
      const nome = asset.name.toLowerCase();
      if (nome.endsWith(".exe") && nome.includes("x86_64") && !nome.includes("arm")) {
        const destino = path.join(REPO_RUSTDESK, asset.name);

        if (fs.existsSync(destino)) {
          log(`Última versão já existe: ${asset.name}`);
          break;
        }

        log(`Baixando ${asset.name}`);

        const download = await fetch(asset.browser_download_url, {
          signal: AbortSignal.timeout(600000)
        });
        if (!download.ok || !download.body) {
          log(`[ERRO] Falha no download: HTTP ${download.status}`);
          return;
        }

        const buffer = Buffer.from(await download.arrayBuffer());
        await fsp.writeFile(destino, buffer);
        break;
      }
    }

    const arquivos = (await fsp.readdir(REPO_RUSTDESK))
      .filter((a) => a.toLowerCase().startsWith("rustdesk") && a.toLowerCase().endsWith(".exe"))
      .sort((a, b) => compararVersoes(extrairVersao(b), extrairVersao(a)));

    if (!arquivos.length) {
      log("Repositório atualizado (sem versões locais).");
      return;
    }

    log(`[REPOSITORIO] Mantendo: ${arquivos[0]}`);

    for (const arquivo of arquivos.slice(1)) {
      try {
        await fsp.unlink(path.join(REPO_RUSTDESK, arquivo));
        log(`Versão removida: ${arquivo}`);
      } catch {
        /* ignora */
      }
    }

    log(`Versão atual: ${arquivos[0]}`);
    log("Repositório atualizado.");
  } catch (erro) {
    log(`[ERRO] Repositório: ${erro instanceof Error ? erro.message : String(erro)}`);
  }
}

/** Equivalente ao obter_guid_rustdesk: consulta o registro remoto via tarefa. */
async function obterGuidRustdesk(hostname: string, log: (t: string) => void): Promise<string | null> {
  try {
    const comando =
      `cmd.exe /c reg query ` +
      `"HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\RustDesk" ` +
      `/v QuietUninstallString > C:\\Temp\\rustdesk_guid.txt`;

    const sucesso = await executarTarefaRemota(
      hostname,
      `RustDeskGuid_${Math.floor(Date.now() / 1000)}`,
      comando,
      log
    );

    if (!sucesso) return null;

    const caminho = `\\\\${hostname}\\c$\\Temp\\rustdesk_guid.txt`;

    for (let i = 0; i < 5; i++) {
      if (await caminhoExiste(caminho)) break;
      await sleep(1000);
    }

    if (!(await caminhoExiste(caminho))) return null;

    const conteudo = lerArquivoCp850(caminho) || "";
    const m = conteudo.match(/\{[A-F0-9\-]+\}/i);
    return m ? m[0] : null;
  } catch {
    return null;
  }
}

/** Equivalente ao desinstalar_rustdesk do rustdesk.py. */
export async function desinstalarRustdesk(
  hostname: string,
  log: (t: string) => void,
  progresso: (fracao: number, texto?: string) => void
): Promise<boolean> {
  log(`[INFO] Iniciando desinstalação em ${hostname}`);
  progresso(0, "Removendo RustDesk...");

  let guid: string | null = null;
  try {
    guid = await obterGuidRustdesk(hostname, log);
  } catch {
    guid = null;
  }

  let sucesso = false;

  if (guid) {
    log(`[INFO] GUID encontrado: ${guid}`);
    sucesso = await executarTarefaRemota(
      hostname,
      `RustDeskRemoveMSI_${hostname}_${Math.floor(Date.now() / 1000)}`,
      `msiexec.exe /qn /X ${guid}`,
      log
    );
  } else {
    log("[INFO] GUID não encontrado.");
  }

  if (!sucesso) {
    sucesso = await executarTarefaRemota(
      hostname,
      `RustDeskRemove32_${hostname}_${Math.floor(Date.now() / 1000)}`,
      `cmd.exe /c ""C:\\Program Files (x86)\\RustDesk\\RustDesk.exe" --uninstall"`,
      log
    );
  }

  if (!sucesso) {
    log("[INFO] Tentando desinstalação via WMIC...");
    sucesso = await executarTarefaRemota(
      hostname,
      `RustDeskRemoveWMIC_${hostname}`,
      `cmd.exe /c wmic product where "name like '%%RustDesk%%'" call uninstall /nointeractive`,
      log
    );
  }

  if (!sucesso) {
    log("[INFO] Tentando desinstalação via Registro...");
    const comandoPs =
      `powershell -ExecutionPolicy Bypass -Command ` +
      `"Get-ItemProperty ` +
      `HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*,` +
      `HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\* ` +
      `| Where-Object {$_.DisplayName -like '*RustDesk*'} ` +
      `| ForEach-Object {Start-Process cmd.exe -ArgumentList '/c ',$_.UninstallString -Wait}"`;
    sucesso = await executarTarefaRemota(hostname, `RustDeskRemoveReg_${hostname}`, comandoPs, log);
  }

  if (sucesso) {
    log("[OK] Desinstalação iniciada.");
    log("[INFO] Aguardando processo de remoção...");

    for (let i = 0; i < 24; i++) {
      await sleep(5000);
      const caminho = await obterCaminhoRustdesk(hostname);
      const servicoExiste = await servicoRustdeskExiste(hostname);

      if (!caminho && !servicoExiste) {
        log("[OK] RustDesk removido.");
        progresso(1, "✅ RustDesk removido");
        return true;
      }
    }

    log("[AVISO] Tempo limite aguardando remoção.");
    progresso(0, "⚠ Tempo limite aguardando remoção");
    return false;
  }

  log("[ERRO] Falha na desinstalação.");
  progresso(0, "⚠ Falha na desinstalação");
  return false;
}

/** Equivalente ao instalar_rustdesk_real: copia o instalador e executa via tarefa. */
async function instalarRustdeskReal(
  hostname: string,
  log: (t: string) => void,
  progresso: (fracao: number, texto?: string) => void
): Promise<boolean> {
  try {
    const { usuario, senha } = credObter();
    if (!usuario || !senha) {
      log("[ERRO] Credenciais administrativas não configuradas.");
      return false;
    }

    const retorno = await runCmd(
      `net use \\\\${hostname}\\c$ "${senha}" /user:"${usuario}" /persistent:no > nul 2>&1`
    );

    log(`[DEBUG] Conexão C$: ${retorno.code}`);
    if (retorno.code !== 0) {
      log(`[ERRO] Falha ao conectar no C$ (retorno=${retorno.code})`);
      return false;
    }

    log(`[INFO] Iniciando instalação em ${hostname}`);

    const instalador = await localizarInstalador(log);
    log("[INFO] Instalador localizado");

    if (!instalador) {
      log("[ERRO] Nenhum instalador localizado.");
      return false;
    }

    const tempRemoto = `\\\\${hostname}\\c$\\Temp`;

    if (!(await caminhoExiste(tempRemoto))) {
      log("[INFO] Criando pasta Temp...");
      await fsp.mkdir(tempRemoto, { recursive: true });
    }

    const destino = `\\\\${hostname}\\c$\\Temp\\RustDesk.exe`;

    log("Copiando instalador...");
    await fsp.copyFile(instalador, destino);

    if (!(await caminhoExiste(destino))) {
      log("[ERRO] Falha ao copiar.");
      return false;
    }

    log("[OK] Instalador copiado");

    const sucessoExecucao = await executarTarefaRemota(
      hostname,
      `RustDeskInstall_${hostname}`,
      "C:\\Temp\\RustDesk.exe --silent-install",
      log
    );

    if (!sucessoExecucao) {
      log("[ERRO] Falha ao iniciar instalação.");
      return false;
    }

    log("[OK] Instalação iniciada");
    progresso(0.3, "Instalando RustDesk...");

    const rustdesk64 = `\\\\${hostname}\\c$\\Program Files\\RustDesk\\rustdesk.exe`;
    const rustdesk32 = `\\\\${hostname}\\c$\\Program Files (x86)\\RustDesk\\rustdesk.exe`;

    const mVersao = path.basename(instalador).toLowerCase().match(/(\d+(?:\.\d+)+)/);
    const versaoEsperada = mVersao ? mVersao[1] : null;

    for (let i = 0; i < 18; i++) {
      await sleep(10000);

      const caminhoInstalado = await obterCaminhoRustdesk(hostname);
      if (!caminhoInstalado) continue;

      const versao = await obterVersaoArquivo(caminhoInstalado);
      log(`[VERSAO INSTALADA] ${versao}`);

      if (versaoEsperada && versao.includes(versaoEsperada)) {
        log("[OK] Nova versão detectada.");
        break;
      }
    }

    let caminhoFinal: string | null = null;
    if (await caminhoExiste(rustdesk64)) caminhoFinal = rustdesk64;
    else if (await caminhoExiste(rustdesk32)) caminhoFinal = rustdesk32;

    if (caminhoFinal) {
      log(`[OK] RustDesk encontrado: ${caminhoFinal}`);
      progresso(1, "✅ Instalação concluída");
      return true;
    }

    log("[ERRO] Instalação não confirmada");
    return false;
  } catch (erro) {
    log(`[ERRO] Instalação: ${erro instanceof Error ? erro.message : String(erro)}`);
    return false;
  } finally {
    await runCmd(`net use \\\\${hostname}\\c$ /delete /y > nul 2>&1`);
  }
}

export interface Confirmador {
  (titulo: string, mensagem: string): Promise<boolean>;
}

/** Equivalente ao instalar_rustdesk do rustdesk.py (com confirmações). */
export async function instalarRustdesk(
  hostname: string,
  confirmar: Confirmador,
  log: (t: string) => void,
  progresso: (fracao: number, texto?: string) => void
): Promise<boolean> {
  const rustdesk64 = `\\\\${hostname}\\c$\\Program Files\\RustDesk\\rustdesk.exe`;
  const rustdesk32 = `\\\\${hostname}\\c$\\Program Files (x86)\\RustDesk\\rustdesk.exe`;

  const existeAtual = (await caminhoExiste(rustdesk64)) || (await caminhoExiste(rustdesk32));

  let removido = false;

  if (existeAtual) {
    const resposta = await confirmar(
      "Atualização",
      "RustDesk já está instalado.\n\nDeseja remover a versão atual e instalar a mais recente?"
    );
    if (!resposta) return false;

    log("[INFO] Removendo versão atual...");
    log("[INFO] Tentando desinstalação via RustDesk...");

    const guid = await obterGuidRustdesk(hostname, log);

    if (guid) {
      log(`[INFO] GUID encontrado: ${guid}`);
      const sucessoRemove = await executarTarefaRemota(
        hostname,
        `RustDeskRemoveMSI_${hostname}_${Math.floor(Date.now() / 1000)}`,
        `msiexec.exe /qn /X ${guid}`,
        log
      );

      if (sucessoRemove) {
        log("[INFO] Aguardando remoção...");
        for (let i = 0; i < 24; i++) {
          await sleep(5000);
          const servicoExiste = await servicoRustdeskExiste(hostname);
          if (!servicoExiste) {
            removido = true;
            log("[OK] RustDesk removido.");
            break;
          }
        }
      }
    } else {
      log("[INFO] GUID não encontrado.");
    }
  } else {
    removido = true;
    const resposta = await confirmar("Instalação", "RustDesk não encontrado.\n\nDeseja instalar automaticamente?");
    if (!resposta) return false;
  }

  if (existeAtual && !removido) {
    log("[ERRO] Remoção não concluída.");
    return false;
  }

  log("[OK] Remoção concluída. Iniciando nova instalação...");
  log(`[DEBUG] removido=${removido}`);
  log(`[DEBUG] existe_64=${await caminhoExiste(rustdesk64)}`);
  log(`[DEBUG] existe_32=${await caminhoExiste(rustdesk32)}`);

  progresso(0.1, "Instalando RustDesk...");

  const sucesso = await instalarRustdeskReal(hostname, log, progresso);

  return sucesso;
}
