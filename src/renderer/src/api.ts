import { Dispositivo, ScannerColumn } from "@shared";

export interface Credenciais {
  usuario: string | null;
  senha: string | null;
}

export interface CredencialValidacao {
  valido: boolean;
  motivo: string;
  usuario: string | null;
}

export interface AppInfo {
  versao: string;
  userData: string;
  auditoria: string;
  hostname: string;
  ipLocal?: string;
}

export interface RustdeskVerificacao {
  instalado: boolean;
  caminho: string | null;
  versao: string;
  configurado: boolean;
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

export interface LogEvento {
  escopo: "rustdesk" | "scanner" | "adm" | "app";
  texto: string;
  ts: number;
}

export interface ProgressoEvento {
  escopo: string;
  fracao: number;
  texto?: string;
}

export interface AdmResultado {
  sucesso: boolean;
  processadas: number;
}

export const api = {
  info: () => window.api.invoke("app:info") as Promise<AppInfo>,
  copiar: (texto: string) => window.api.invoke("app:copia", texto) as Promise<boolean>,
  confirmarResposta: (valor: boolean) =>
    window.api.invoke("app:confirmar-resposta", valor) as Promise<boolean>,
  verificarAtualizacao: () =>
    window.api.invoke("app:atualizacaoVerificar") as Promise<boolean | string>,
  instalarAtualizacao: () => window.api.invoke("app:atualizacaoInstalar") as Promise<void>,

  credObter: () => window.api.invoke("cred:obter") as Promise<Credenciais>,
  credSalvar: (usuario: string, senha: string) =>
    window.api.invoke("cred:salvar", usuario, senha) as Promise<boolean>,
  credRemover: () => window.api.invoke("cred:remover") as Promise<boolean>,
  credValidar: () =>
    window.api.invoke("cred:validar") as Promise<CredencialValidacao>,

  ping: (host: string) =>
    window.api.invoke("net:ping", host) as Promise<{ online: boolean; tempo: number | null }>,
  resolver: (valor: string) =>
    window.api.invoke("net:resolver", valor) as Promise<{ hostname: string; ip: string }>,
  listarUsuarios: (hostname: string) =>
    window.api.invoke("net:usuarios", hostname) as Promise<string[]>,

  rustdeskVerificar: (hostname: string) =>
    window.api.invoke("rustdesk:verificar", hostname) as Promise<RustdeskVerificacao>,
  rustdeskConfigurar: (hostname: string, senha: string) =>
    window.api.invoke("rustdesk:configurar", { hostname, senha }) as Promise<ResultadoConfiguracao>,
  rustdeskInstalar: (hostname: string) =>
    window.api.invoke("rustdesk:instalar", { hostname }) as Promise<boolean>,
  rustdeskDesinstalar: (hostname: string) =>
    window.api.invoke("rustdesk:desinstalar", { hostname }) as Promise<boolean>,
  rustdeskVersaoRepositorio: () =>
    window.api.invoke("rustdesk:versaoRepositorio") as Promise<string | null>,
  rustdeskAtualizarRepositorio: () =>
    window.api.invoke("rustdesk:atualizarRepositorio") as Promise<boolean>,

  scannerIniciar: (opcoes: {
    modo: "cidr" | "faixa";
    ipBase?: string;
    cidr?: number;
    inicio?: string;
    fim?: string;
    colunas: string[];
  }) => window.api.invoke("scanner:iniciar", opcoes) as Promise<boolean>,
  scannerCancelar: () => window.api.invoke("scanner:cancelar") as Promise<boolean>,
  scannerColunasObter: () =>
    window.api.invoke("scanner:colunasObter") as Promise<string[]>,
  scannerColunasSalvar: (colunas: string[]) =>
    window.api.invoke("scanner:colunasSalvar", colunas) as Promise<boolean>,

  admExecutar: (opcoes: {
    acao: string;
    nomeUsuario: string;
    senhaUsuario: string;
    computadores: string[];
  }) => window.api.invoke("adm:executar", opcoes) as Promise<AdmResultado>,
  admCancelar: () => window.api.invoke("adm:cancelar") as Promise<boolean>,

  onLog: (cb: (e: LogEvento) => void) => window.api.on("evt:log", cb as (p: unknown) => void),
  onProgresso: (cb: (e: ProgressoEvento) => void) =>
    window.api.on("evt:progresso", cb as (p: unknown) => void),
  onConfirmar: (cb: (e: { titulo: string; mensagem: string }) => void) =>
    window.api.on("evt:confirmar", cb as (p: unknown) => void),

  onScannerDispositivo: (cb: (e: { dispositivo: Dispositivo }) => void) =>
    window.api.on("evt:scanner:dispositivo", cb as (p: unknown) => void),
  onScannerAtualizar: (cb: (e: { ip: string; info: Partial<Dispositivo> }) => void) =>
    window.api.on("evt:scanner:atualizar", cb as (p: unknown) => void),
  onScannerProgresso: (cb: (e: { fracao: number; texto: string }) => void) =>
    window.api.on("evt:scanner:progresso", cb as (p: unknown) => void),
  onScannerLimpar: (cb: () => void) =>
    window.api.on("evt:scanner:limpar", cb as (p: unknown) => void),
  onScannerOrdenar: (cb: () => void) =>
    window.api.on("evt:scanner:ordenar", cb as (p: unknown) => void),
  onScannerFinalizado: (cb: (e: { cancelado: boolean }) => void) =>
    window.api.on("evt:scanner:finalizado", cb as (p: unknown) => void),
  onScannerEstado: (cb: (e: { emExecucao: boolean }) => void) =>
    window.api.on("evt:scanner:estado", cb as (p: unknown) => void),
  onScannerErro: (cb: (e: { erro: string }) => void) =>
    window.api.on("evt:scanner:erro", cb as (p: unknown) => void),

  onAdmLinha: (cb: (e: { texto: string }) => void) =>
    window.api.on("evt:adm:linha", cb as (p: unknown) => void),
  onAdmFinalizado: (cb: (e: AdmResultado) => void) =>
    window.api.on("evt:adm:finalizado", cb as (p: unknown) => void),

  onUpdate: (cb: (e: UpdateEvento) => void) => window.api.on("evt:update", cb as (p: unknown) => void)
};

export interface UpdateEvento {
  estado: "verificando" | "disponivel" | "atualizado" | "baixando" | "baixado" | "erro";
  versao?: string;
  percentual?: number;
  mensagem?: string;
}

export type { Dispositivo, ScannerColumn };
