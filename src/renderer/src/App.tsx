import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api, AppInfo, UpdateEvento } from "./api";
import { Modal, UIProvider, useUI } from "./components/ui";
import {
  IconCheck,
  IconDownload,
  IconKey,
  IconLaptop,
  IconRefresh,
  IconScan,
  IconSettings,
  IconUserCog,
  IconUsers
} from "./components/Icons";
import { RustDeskPage } from "./pages/RustDeskPage";
import { ScannerPage } from "./pages/ScannerPage";
import { AdmLocalPage } from "./pages/AdmLocalPage";

export type Pagina = "rustdesk" | "scanner" | "adm";

export type EstadoCredencial =
  | "validando"
  | "valida"
  | "expirada"
  | "adm-local"
  | "dominio"
  | "sem-conexao"
  | "sem-permissao"
  | "falha"
  | "ausente";

interface EstadoCred {
  usuario: string | null;
  estado: EstadoCredencial;
}

export interface CredencialApi {
  cred: EstadoCred;
  validarCredencial: (silencioso?: boolean) => Promise<boolean>;
  abrirCredenciais: (bloqueiaFechamento?: boolean) => void;
  revalidar: () => void;
}

export const PaginasConfig: Record<Pagina, { titulo: string; subtitulo: string; tag: string }> = {
  rustdesk: {
    titulo: "Gerenciador de Rustdesk",
    subtitulo: "Instale, configure e gerencie o RustDesk em máquinas remotas",
    tag: "REMOTO • AUTOMATIZADO • AUDITADO"
  },
  scanner: {
    titulo: "IP Scanner",
    subtitulo: "Escaneie sua rede e descubra informações dos dispositivos",
    tag: "SIMPLES • RÁPIDO • COMPLETO"
  },
  adm: {
    titulo: "Gerenciador ADM Local",
    subtitulo: "Crie, altere ou remova administradores locais em máquinas remotas",
    tag: "REMOTO • CREDENCIAIS • AUTOMATIZADO"
  }
};

function rotuloCredencial(cred: EstadoCred): { texto: string; classe: string } {
  switch (cred.estado) {
    case "valida":
      return { texto: `🔑 ${cred.usuario || ""} | ✅ Válida`, classe: "ok" };
    case "validando":
      return { texto: "🔑 Validando...", classe: "warn" };
    case "expirada":
      return { texto: `🔑 ${cred.usuario || ""} | ❌ Expirada`, classe: "err" };
    case "adm-local":
      return { texto: `🔑 ${cred.usuario || ""} | ⛔ ADM Local Bloqueado`, classe: "err" };
    case "dominio":
      return { texto: `🔑 ${cred.usuario || ""} | ⛔ Domínio Inválido`, classe: "err" };
    case "sem-conexao":
      return { texto: `🔑 ${cred.usuario || ""} | 🌐 Sem Conexão`, classe: "warn" };
    case "sem-permissao":
      return { texto: `🔑 ${cred.usuario || ""} | 🌐 Sem permissões administrativas`, classe: "warn" };
    case "ausente":
      return { texto: "🔑 Credencial: Não Configurada", classe: "warn" };
    default:
      return { texto: `🔑 ${cred.usuario || ""} | ⚠ Falha de Verificação`, classe: "warn" };
  }
}

function estadoPorMotivo(motivo: string): EstadoCredencial {
  const m = motivo.toLowerCase();
  if (m.includes("senha expirada") || m.includes("credencial inválida")) return "expirada";
  if (m.includes("administrador local não permitido")) return "adm-local";
  if (m.includes("usuário deve ser do domínio") || m.includes("domínio não permitido")) return "dominio";
  if (m.includes("servidor de validação indisponível")) return "sem-conexao";
  if (m.includes("usuário sem permissões administrativas")) return "sem-permissao";
  if (m.includes("nenhuma credencial cadastrada")) return "ausente";
  return "falha";
}

function AppInterno() {
  const ui = useUI();
  const [pagina, setPagina] = useState<Pagina>("rustdesk");
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [cred, setCred] = useState<EstadoCred>({ usuario: null, estado: "validando" });
  const [modalCredenciais, setModalCredenciais] = useState<{ bloqueia: boolean } | null>(null);
  const [modalConfig, setModalConfig] = useState(false);
  const [update, setUpdate] = useState<UpdateEvento | null>(null);
  const alertaSenhaRef = useRef(false);

  useEffect(() => {
    void api.info().then(setInfo);
    const offUpdate = api.onUpdate(setUpdate);
    // Confirmações solicitadas pelo processo principal (instalação etc.)
    const offConfirmar = api.onConfirmar(async (e) => {
      const resposta = await ui.mostrarDialog({
        tipo: "confirm",
        titulo: e.titulo,
        mensagem: e.mensagem
      });
      await api.confirmarResposta(resposta);
    });
    return () => {
      offUpdate();
      offConfirmar();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const revalidar = useCallback(() => {
    alertaSenhaRef.current = false;
    setCred((c) => ({ ...c, estado: "validando" }));
  }, []);

  // Validação inicial + periódica (30 min, como no Python)
  useEffect(() => {
    let vivo = true;

    const validar = async (silencioso: boolean) => {
      setCred((c) => ({ ...c, estado: "validando" }));
      const resultado = await api.credValidar();
      if (!vivo) return;

      if (resultado.valido) {
        alertaSenhaRef.current = false;
        setCred({ usuario: resultado.usuario, estado: "valida" });
        return;
      }

      const estado = estadoPorMotivo(resultado.motivo);
      setCred({ usuario: resultado.usuario, estado });

      if (silencioso) return;

      const m = resultado.motivo.toLowerCase();
      if (m.includes("senha expirada") || m.includes("credencial inválida")) {
        if (!alertaSenhaRef.current) {
          alertaSenhaRef.current = true;
          await ui.mostrarMensagem(
            "warning",
            "Senha Expirada",
            `A senha do usuário:\n\n${resultado.usuario || ""}\n\nparece estar expirada ou inválida.\n\nGere uma nova senha no portal e atualize as credenciais.`
          );
          setModalCredenciais({ bloqueia: true });
        }
      } else if (m.includes("nenhuma credencial cadastrada")) {
        setModalCredenciais({ bloqueia: true });
      }
    };

    void api.credObter().then((c) => {
      if (c.usuario && c.senha) {
        void validar(false);
      } else {
        setCred({ usuario: null, estado: "ausente" });
        setModalCredenciais({ bloqueia: true });
      }
    });

    const intervalo = setInterval(() => {
      void validar(true);
    }, 30 * 60 * 1000);

    return () => {
      vivo = false;
      clearInterval(intervalo);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Equivalente ao validar_credencial_para_operacao
  const validarCredencial = useCallback(
    async (silencioso = false): Promise<boolean> => {
      const resultado = await api.credValidar();

      if (resultado.valido) {
        alertaSenhaRef.current = false;
        setCred({ usuario: resultado.usuario, estado: "valida" });
        return true;
      }

      const estado = estadoPorMotivo(resultado.motivo);
      setCred({ usuario: resultado.usuario, estado });

      if (silencioso) return false;

      const m = resultado.motivo.toLowerCase();

      if (m.includes("senha expirada") || m.includes("credencial inválida")) {
        if (!alertaSenhaRef.current) {
          alertaSenhaRef.current = true;
          await ui.mostrarMensagem(
            "warning",
            "Senha Expirada",
            `A senha do usuário:\n\n${resultado.usuario || ""}\n\nparece estar expirada ou inválida.\n\nGere uma nova senha no portal e atualize as credenciais.`
          );
          setModalCredenciais({ bloqueia: true });
        }
      } else if (m.includes("usuário sem permissões administrativas")) {
        const editar = await ui.mostrarDialog({
          tipo: "confirm",
          titulo: "Permissão Administrativa",
          mensagem:
            "A credencial atual não possui permissões administrativas.\n\nVocê deseja editar sua credencial para utilizar funções ADM?"
        });
        if (editar) setModalCredenciais({ bloqueia: false });
      } else if (m.includes("administrador local não permitido")) {
        const editar = await ui.mostrarDialog({
          tipo: "confirm",
          titulo: "Administrador Local Bloqueado",
          mensagem:
            "A credencial configurada é um administrador local.\n\nAdministradores locais não possuem permissões administrativas!\n\nDeseja editar a credencial agora?"
        });
        if (editar) setModalCredenciais({ bloqueia: false });
      } else if (m.includes("nenhuma credencial cadastrada")) {
        setModalCredenciais({ bloqueia: true });
      } else {
        await ui.mostrarMensagem("warning", "Validação", resultado.motivo);
      }

      return false;
    },
    [ui]
  );

  const abrirCredenciais = useCallback((bloqueiaFechamento = false) => {
    setModalCredenciais({ bloqueia: bloqueiaFechamento });
  }, []);

  const credencialApi: CredencialApi = { cred, validarCredencial, abrirCredenciais, revalidar };

  const chip = rotuloCredencial(cred);

  const rotuloUpdate = () => {
    if (!update) return `v${info?.versao || "?"}`;
    switch (update.estado) {
      case "baixando":
        return `⬇ Baixando atualização (${update.percentual ?? 0}%)`;
      case "baixado":
        return `⬆ Atualização ${update.versao} pronta (reinicie para instalar)`;
      case "disponivel":
        return `⬆ Atualização ${update.versao} disponível`;
      case "erro":
        return `v${info?.versao || "?"}`;
      default:
        return `v${info?.versao || "?"}`;
    }
  };

  return (
    <CredencialContext.Provider value={credencialApi}>
      <div className="app">
        <aside className="sidebar">
          <div className="logo">
            <div className="logo-mark">
              <IconLaptop size={22} />
            </div>
            <div>
              <div className="logo-text">Gerenciador de TI</div>
              <div className="logo-sub">by Machado_Scripts</div>
            </div>
          </div>

          <button
            className={`nav-item ${pagina === "rustdesk" ? "active" : ""}`}
            onClick={() => setPagina("rustdesk")}
          >
            <IconUsers size={18} />
            Gerenciador RustDesk
          </button>
          <button
            className={`nav-item ${pagina === "scanner" ? "active" : ""}`}
            onClick={() => setPagina("scanner")}
          >
            <IconScan size={18} />
            IP Scanner
          </button>
          <button
            className={`nav-item ${pagina === "adm" ? "active" : ""}`}
            onClick={() => setPagina("adm")}
          >
            <IconUserCog size={18} />
            ADM Local
          </button>

          <div className="sidebar-footer">
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <IconRefresh size={12} /> {rotuloUpdate()}
            </div>
            <div>{info?.hostname ? `Computador: ${info.hostname}` : ""}</div>
            <div>Machado_Scripts © {new Date().getFullYear()}</div>
          </div>
        </aside>

        <div className="content" style={{ overflow: "hidden" }}>
          <div className="topbar">
            <div>
              <div className="topbar-title">{PaginasConfig[pagina].titulo}</div>
              <div className="topbar-sub">{PaginasConfig[pagina].subtitulo}</div>
            </div>
            <div className="topbar-spacer" />
            <div className={`chip ${chip.classe}`} title={chip.texto}>
              {chip.texto}
            </div>
            <button
              className="btn secondary"
              style={{ width: 42, padding: 0 }}
              title="Configurações"
              onClick={() => setModalConfig(true)}
            >
              <IconSettings size={18} />
            </button>
          </div>

          <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
            <div className={pagina === "rustdesk" ? "" : "page-hidden"} style={{ height: "100%" }}>
              <RustDeskPage />
            </div>
            <div className={pagina === "scanner" ? "" : "page-hidden"} style={{ height: "100%" }}>
              <ScannerPage />
            </div>
            <div className={pagina === "adm" ? "" : "page-hidden"} style={{ height: "100%" }}>
              <AdmLocalPage />
            </div>
          </div>
        </div>
      </div>

      {modalCredenciais && (
        <ModalCredenciais
          bloqueia={modalCredenciais.bloqueia}
          aoFechar={() => setModalCredenciais(null)}
        />
      )}

      {modalConfig && <ModalConfiguracoes aoFechar={() => setModalConfig(false)} />}
    </CredencialContext.Provider>
  );
}

// ------------------------------------------------------------------ //
// Contexto de credenciais (acessível às páginas)
// ------------------------------------------------------------------ //

export const CredencialContext = createContext<CredencialApi>(null as unknown as CredencialApi);

export function useCredencial(): CredencialApi {
  return useContext(CredencialContext);
}

// ------------------------------------------------------------------ //
// Modal: Editar Credenciais
// ------------------------------------------------------------------ //

function ModalCredenciais({ bloqueia, aoFechar }: { bloqueia: boolean; aoFechar: () => void }) {
  const ui = useUI();
  const { revalidar } = useCredencial();
  const [usuario, setUsuario] = useState("");
  const [senha, setSenha] = useState("");
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    void api.credObter().then((c) => {
      setUsuario(c.usuario || "");
      setSenha(c.senha || "");
      setCarregando(false);
    });
  }, []);

  const tentarFechar = async () => {
    if (bloqueia) {
      const atual = await api.credObter();
      if (!(atual.usuario && atual.senha)) {
        await ui.mostrarMensagem(
          "warning",
          "Credenciais",
          "É necessário configurar as credenciais administrativas antes de utilizar o sistema."
        );
        return;
      }
    }
    aoFechar();
  };

  const salvar = async () => {
    if (!usuario.trim()) {
      await ui.mostrarMensagem("warning", "Credenciais", "Informe o usuário.");
      return;
    }
    if (!senha) {
      await ui.mostrarMensagem("warning", "Credenciais", "Informe a senha.");
      return;
    }

    await api.credSalvar(usuario.trim(), senha);
    revalidar();
    await ui.mostrarMensagem("success", "Credenciais", "Credenciais atualizadas.\n\nValidando...");
    aoFechar();
  };

  const remover = async () => {
    await api.credRemover();
    setUsuario("");
    setSenha("");
    revalidar();
    await ui.mostrarMensagem("info", "Credenciais", "Credenciais removidas.");
  };

  return (
    <Modal
      titulo="Atualizar Credenciais"
      icone={
        <div className="modal-icon confirm">
          <IconKey size={20} />
        </div>
      }
      largura={460}
      rodape={
        <>
          <button className="btn secondary" onClick={remover}>
            Remover
          </button>
          <div style={{ flex: 1 }} />
          {!bloqueia && (
            <button className="btn secondary" onClick={() => aoFechar()}>
              Cancelar
            </button>
          )}
          <button className="btn" onClick={salvar} disabled={carregando}>
            <IconCheck size={16} /> Salvar
          </button>
        </>
      }
    >
      <div className="field">
        <label>Usuário</label>
        <input
          className="input"
          value={usuario}
          onChange={(e) => setUsuario(e.target.value)}
          placeholder="DOMINIO\\usuario ou usuario"
          disabled={carregando}
        />
      </div>
      <div className="field">
        <label>Senha</label>
        <input
          className="input"
          type="password"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          disabled={carregando}
        />
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)" }}>
        As credenciais são armazenadas criptografadas (DPAPI) no perfil do usuário.
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ //
// Modal: Configurações
// ------------------------------------------------------------------ //

function ModalConfiguracoes({ aoFechar }: { aoFechar: () => void }) {
  const ui = useUI();
  const { abrirCredenciais } = useCredencial();
  const [atualizando, setAtualizando] = useState(false);

  const atualizarRepositorio = async () => {
    setAtualizando(true);
    try {
      await api.rustdeskAtualizarRepositorio();
      await ui.mostrarMensagem(
        "success",
        "Repositório",
        "Processo de atualização do repositório finalizado.\n\nConsulte os logs na aba Gerenciador RustDesk."
      );
    } finally {
      setAtualizando(false);
    }
  };

  return (
    <Modal
      titulo="Configurações"
      icone={
        <div className="modal-icon info">
          <IconSettings size={20} />
        </div>
      }
      largura={440}
      rodape={
        <button className="btn danger" onClick={aoFechar}>
          Fechar
        </button>
      }
    >
      <button className="btn secondary block lg" onClick={() => { aoFechar(); abrirCredenciais(false); }}>
        <IconKey size={16} /> Editar Credenciais
      </button>
      <button
        className="btn secondary block lg"
        onClick={atualizarRepositorio}
        disabled={atualizando}
      >
        <IconDownload size={16} />
        {atualizando ? "Atualizando repositório..." : "Atualizar Versão do Rustdesk do Repositório"}
      </button>
    </Modal>
  );
}

export default function App() {
  return (
    <UIProvider>
      <AppInterno />
    </UIProvider>
  );
}
