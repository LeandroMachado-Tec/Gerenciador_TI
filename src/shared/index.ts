export interface ScannerColumn {
  id: string;
  titulo: string;
  peso: number;
  tipo: "texto" | "badge";
  larguraMin: number;
}

export const SCANNER_COLUNAS: ScannerColumn[] = [
  { id: "ip", titulo: "Endereço IP", peso: 5, tipo: "texto", larguraMin: 96 },
  { id: "hostname", titulo: "Hostname", peso: 5, tipo: "texto", larguraMin: 96 },
  { id: "mac", titulo: "Endereço MAC", peso: 5, tipo: "texto", larguraMin: 108 },
  { id: "fabricante", titulo: "Fabricante", peso: 4, tipo: "texto", larguraMin: 80 },
  { id: "status", titulo: "Status", peso: 3, tipo: "badge", larguraMin: 86 },
  { id: "tempo", titulo: "Tempo de Resposta", peso: 3, tipo: "texto", larguraMin: 78 },
  { id: "rustdesk", titulo: "Rustdesk Instalado", peso: 3, tipo: "badge", larguraMin: 94 },
  { id: "configurado", titulo: "Configurado", peso: 3, tipo: "badge", larguraMin: 94 },
  { id: "versao", titulo: "Versão Rustdesk", peso: 3, tipo: "texto", larguraMin: 92 },
  { id: "atualizacao", titulo: "Atualização Disponível", peso: 4, tipo: "badge", larguraMin: 104 },
  { id: "usuarios", titulo: "Usuários (C:)", peso: 3, tipo: "texto", larguraMin: 76 },
  { id: "serial", titulo: "Número de Série", peso: 5, tipo: "texto", larguraMin: 84 }
];

export const SCANNER_COLUNAS_OBRIGATORIAS = ["ip", "hostname"];

export const SCANNER_ESTATISTICAS = [
  { chave: "total", legenda: "Dispositivos encontrados", cor: "#3B82F6" },
  { chave: "online", legenda: "Online", cor: "#22C55E" },
  { chave: "offline", legenda: "Offline", cor: "#EF4444" },
  { chave: "rustdesk", legenda: "Com Rustdesk", cor: "#3B82F6" },
  { chave: "configurados", legenda: "Configurados", cor: "#94A3B8" },
  { chave: "atualizacao", legenda: "Com atualização disponível", cor: "#F59E0B" },
  { chave: "usuarios", legenda: "Total de usuários (C:)", cor: "#3B82F6" }
];

export const OUI_FABRICANTES: Record<string, string> = {
  "00:05:69": "VMware",
  "00:0C:29": "VMware",
  "00:50:56": "VMware",
  "00:15:5D": "Microsoft",
  "00:03:FF": "Microsoft",
  "00:1C:42": "Parallels",
  "08:00:27": "VirtualBox",
  "52:54:00": "QEMU",
  "00:16:3E": "Xen",
  "B8:27:EB": "Raspberry Pi",
  "E4:5F:01": "Raspberry Pi",
  "DC:A6:32": "Raspberry Pi",
  "F0:9F:C2": "Ubiquiti",
  "24:4B:FE": "ASUS",
  "00:1B:21": "Intel",
  "3C:5A:B4": "Google"
};

export const SERVER_IP = "23.21.220.60";
export const RUSTDESK_KEY = "40G92UOLqdp840PRepEjTTTUSLoThP8r3IP4DokUSBc=";
export const RUSTDESK_SENHA_PADRAO = "@Reded0R";
export const REPO_RUSTDESK = "\\\\rdfscl01\\tax$\\M\\Programas\\Rustdesk";
export const DOMINIO_PADRAO = "REDEDOR";

export const ADM_ACOES: Record<string, string> = {
  "Criar Usuário ADM": "criar",
  "Alterar Senha do Usuário": "senha",
  "Excluir Usuário e Perfil": "excluir",
  "Verificar Status": "status"
};

export const ADM_ACOES_TEXTO: Record<string, string> = {
  criar: "criacao do usuario",
  senha: "alteracao de senha do usuario",
  excluir: "exclusao do usuario e perfil",
  status: "consulta do usuario"
};

export const ADM_ACOES_COM_SENHA = ["criar", "senha"];

export const CARACTERES_INVALIDOS = '\\/:*?"<>|';

export function validarNomeUsuario(nome: string): { nome: string | null; erro: string | null } {
  let valor = (nome || "").trim();
  if (valor.startsWith(".\\")) valor = valor.slice(2).trim();
  if (!valor) return { nome: null, erro: "Informe o nome do usuário local." };
  for (const caractere of CARACTERES_INVALIDOS) {
    if (valor.includes(caractere)) return { nome: null, erro: "O nome informado possui caracteres inválidos." };
  }
  return { nome: valor, erro: null };
}

export function analisarComputadores(texto: string): string[] {
  const brutas = (texto || "").split(/[,;\n]/);
  const lista: string[] = [];
  for (const bruta of brutas) {
    const valor = bruta.trim();
    if (valor && !lista.includes(valor)) lista.push(valor);
  }
  return lista;
}

export function validarCamposAdm(
  acao: string | null,
  nomeUsuario: string,
  senhaUsuario: string,
  textoComputadores: string
): { computadores: string[] | null; erro: string | null } {
  const acoes = Object.values(ADM_ACOES);
  if (!acao || !acoes.includes(acao)) return { computadores: null, erro: "Selecione uma ação válida." };

  const { erro } = validarNomeUsuario(nomeUsuario);
  if (erro) return { computadores: null, erro };

  const computadores = analisarComputadores(textoComputadores);
  if (!computadores.length) return { computadores: null, erro: "Informe ao menos um computador (hostname ou IP)." };

  if (ADM_ACOES_COM_SENHA.includes(acao) && !(senhaUsuario || "").trim()) {
    return { computadores: null, erro: "Informe a senha do usuário local." };
  }

  return { computadores, erro: null };
}

function escaparValorBatch(valor: string): string {
  return String(valor)
    .replace("^", "^^")
    .replace("&", "^&")
    .replace("|", "^|")
    .replace("<", "^<")
    .replace(">", "^>")
    .replace("%", "%%")
    .replace("!", "^^!")
    .replace('"', '^"');
}

const LOG_REMOTO = "C:\\Windows\\Temp\\resultado_admin.txt";

export function gerarBat(acao: string, nome: string, senha?: string): string {
  const usuarioB = escaparValorBatch(nome);
  const senhaB = senha ? escaparValorBatch(senha) : "";
  const usuarioPs = nome.replace("'", "''");

  if (acao === "criar") {
    return (
      `@echo off\r\n` +
      `setlocal DisableDelayedExpansion\r\n` +
      `chcp 850 >nul\r\n` +
      `echo Executando Criacao... > ${LOG_REMOTO}\r\n` +
      `net user "${usuarioB}" "${senhaB}" /add /y >> ${LOG_REMOTO} 2>&1\r\n` +
      `if errorlevel 1 goto :fim\r\n` +
      `net localgroup Administradores "${usuarioB}" /add >> ${LOG_REMOTO} 2>&1\r\n` +
      `net localgroup Administrators "${usuarioB}" /add >> ${LOG_REMOTO} 2>&1\r\n` +
      `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Set-LocalUser -Name '${usuarioPs}' -PasswordNeverExpires \`$true" >> ${LOG_REMOTO} 2>&1\r\n` +
      `:fim\r\n` +
      `echo PROCESSO_CONCLUIDO >> ${LOG_REMOTO}\r\n` +
      `endlocal\r\n`
    );
  }

  if (acao === "senha") {
    return (
      `@echo off\r\n` +
      `setlocal DisableDelayedExpansion\r\n` +
      `chcp 850 >nul\r\n` +
      `echo Executando Alteracao de Senha... > ${LOG_REMOTO}\r\n` +
      `net user "${usuarioB}" "${senhaB}" >> ${LOG_REMOTO} 2>&1\r\n` +
      `echo SENHA_ALTERADA >> ${LOG_REMOTO}\r\n` +
      `endlocal\r\n`
    );
  }

  if (acao === "excluir") {
    return (
      `@echo off\r\n` +
      `setlocal DisableDelayedExpansion\r\n` +
      `chcp 850 >nul\r\n` +
      `echo Executando Exclusao... > ${LOG_REMOTO}\r\n` +
      `net user "${usuarioB}" /delete >> ${LOG_REMOTO} 2>&1\r\n` +
      `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_UserProfile ^| Where-Object { \`$_.LocalPath -eq 'C:\\Users\\${usuarioPs}' } ^| Remove-CimInstance" >> ${LOG_REMOTO} 2>&1\r\n` +
      `if exist "C:\\Users\\${usuarioB}" rd /s /q "C:\\Users\\${usuarioB}" >> ${LOG_REMOTO} 2>&1\r\n` +
      `echo EXCLUSAO_CONCLUIDA >> ${LOG_REMOTO}\r\n` +
      `endlocal\r\n`
    );
  }

  if (acao === "status") {
    return (
      `@echo off\r\n` +
      `setlocal DisableDelayedExpansion\r\n` +
      `chcp 850 >nul\r\n` +
      `echo Consultando Status do Usuario ${usuarioB}... > ${LOG_REMOTO}\r\n` +
      `echo ---------------------------------------------------- >> ${LOG_REMOTO}\r\n` +
      `net user "${usuarioB}" >> ${LOG_REMOTO} 2>&1\r\n` +
      `echo ---------------------------------------------------- >> ${LOG_REMOTO}\r\n` +
      `echo Participacao em grupos administrativos: >> ${LOG_REMOTO}\r\n` +
      `net localgroup Administradores | findstr /i /x /c:"${usuarioB}" >> ${LOG_REMOTO} 2>&1\r\n` +
      `net localgroup Administrators | findstr /i /x /c:"${usuarioB}" >> ${LOG_REMOTO} 2>&1\r\n` +
      `echo CONSULTA_CONCLUIDA >> ${LOG_REMOTO}\r\n` +
      `endlocal\r\n`
    );
  }

  throw new Error(`Ação inválida: ${acao}`);
}

export function estiloBadge(chave: string, valor: string): { texto: string; cor: string | null } {
  const texto = String(valor);
  if (chave === "status") {
    return texto === "Online" ? { texto, cor: "#15803D" } : { texto, cor: "#B91C1C" };
  }
  if (chave === "rustdesk" || chave === "configurado") {
    if (texto === "Sim") return { texto, cor: "#15803D" };
    if (texto === "Não") return { texto, cor: "#B91C1C" };
    return { texto, cor: null };
  }
  if (chave === "atualizacao") {
    if (texto.startsWith("Sim")) return { texto, cor: "#B45309" };
    if (texto === "Não") return { texto, cor: "#15803D" };
    return { texto, cor: null };
  }
  return { texto, cor: null };
}

export interface Dispositivo {
  ip: string;
  hostname: string;
  mac: string;
  fabricante: string;
  status: string;
  tempo: string;
  rustdesk: string;
  configurado: string;
  versao: string;
  atualizacao: string;
  usuarios: string;
  serial: string;
}

export function dispositivoVazio(ip: string, online: boolean): Dispositivo {
  return {
    ip,
    hostname: "-",
    mac: "-",
    fabricante: "-",
    status: online ? "Online" : "Offline",
    tempo: "-",
    rustdesk: "-",
    configurado: "-",
    versao: "-",
    atualizacao: "-",
    usuarios: "-",
    serial: "-"
  };
}
