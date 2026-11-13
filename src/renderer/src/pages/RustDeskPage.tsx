import { useCallback, useEffect, useRef, useState } from "react";
import { api, ResumoConfiguracao, RustdeskVerificacao } from "../api";
import { LogBox, LinhaLog } from "../components/LogBox";
import { useUI } from "../components/ui";
import {
  IconActivity,
  IconCopy,
  IconGlobe,
  IconKey,
  IconPackage,
  IconPlay,
  IconRefresh,
  IconSearch,
  IconSettings,
  IconShield,
  IconTag,
  IconTrash,
  IconUsers
} from "../components/Icons";
import { useCredencial } from "../App";
import { RUSTDESK_SENHA_PADRAO } from "@shared";

interface InfoMaquina {
  hostname: string;
  ip: string;
  status: "-" | "online" | "offline";
  rustdesk: "-" | "instalado" | "nao-encontrado";
  configuracao: "-" | "configurado" | "nao-configurado" | "nao-aplicavel";
  versao: string;
  atualizacao: "-" | "atualizado" | `disponivel:${string}` | "nao-instalado";
  usuarios: string;
}

const INFO_INICIAL: InfoMaquina = {
  hostname: "-",
  ip: "-",
  status: "-",
  rustdesk: "-",
  configuracao: "-",
  versao: "-",
  atualizacao: "-",
  usuarios: "-"
};

let contadorLinhas = 0;
function novaLinha(texto: string, ts?: number): LinhaLog {
  return { id: ++contadorLinhas, texto, ts };
}

export function RustDeskPage() {
  const ui = useUI();
  const { validarCredencial } = useCredencial();

  const [hostname, setHostname] = useState("");
  const [senhaRustdesk, setSenhaRustdesk] = useState(RUSTDESK_SENHA_PADRAO);
  const [info, setInfo] = useState<InfoMaquina>(INFO_INICIAL);
  const [logs, setLogs] = useState<LinhaLog[]>([]);
  const [historico, setHistorico] = useState<string[]>([]);
  const [progresso, setProgresso] = useState(0);
  const [status, setStatus] = useState("✅ Pronto para operação");
  const [ocupado, setOcupado] = useState(false);
  const [btnInstalar, setBtnInstalar] = useState<{
    texto: string;
    disabled: boolean;
    variante: string;
  }>({ texto: "Instalar RustDesk", disabled: false, variante: "" });

  const hostnameRef = useRef(hostname);
  hostnameRef.current = hostname;
  const senhaRef = useRef(senhaRustdesk);
  senhaRef.current = senhaRustdesk;

  const log = useCallback((texto: string, ts?: number) => {
    setLogs((l) => [...l.slice(-800), novaLinha(texto, ts)]);
  }, []);

  const registrarHistorico = useCallback(
    (host: string, acao: string, resultado: string) => {
      const agora = new Date().toLocaleString("pt-BR");
      setHistorico((h) =>
        [
          ...h,
          `${agora}\nHost: ${host}\nAção: ${acao}\nResultado: ${resultado}\n${"—".repeat(38)}`
        ].slice(-200)
      );
    },
    []
  );

  // Recebe logs das operações conduzidas no processo principal
  useEffect(() => {
    const off = api.onLog((e) => {
      if (e.escopo === "rustdesk" || e.escopo === "app") log(e.texto, e.ts);
    });
    const offP = api.onProgresso((e) => {
      if (e.escopo === "rustdesk") {
        setProgresso(Math.max(0, Math.min(1, e.fracao)));
        if (e.texto) setStatus(e.texto);
      }
    });
    return () => {
      off();
      offP();
    };
  }, [log]);

  const limparInfoRustdesk = () => {
    setInfo((i) => ({
      ...i,
      rustdesk: "-",
      configuracao: "-",
      versao: "-",
      atualizacao: "-",
      usuarios: "-"
    }));
  };

  const copiar = async (texto: string, rotulo: string) => {
    if (texto && texto !== "-") {
      await api.copiar(texto);
      ui.toast(`📋 ${rotulo} copiado: ${texto}`);
    }
  };

  // ------------------------- Verificar Máquina -------------------------
  const verificarMaquina = useCallback(
    async (hostInput?: string): Promise<RustdeskVerificacao | null> => {
      const host = (hostInput ?? hostnameRef.current).trim();
      if (!host) {
        await ui.mostrarMensagem("warning", "Hostname", "Informe um Hostname ou um IP.");
        return null;
      }

      setProgresso(0);
      setStatus("Iniciando verificação...");

      const { hostname: hostnameResolvido, ip } = await api.resolver(host);
      setProgresso(0.2);
      setStatus("Hostname encontrado");

      const nomeCurto = hostnameResolvido.split(".")[0].toUpperCase();
      setInfo((i) => ({ ...i, hostname: nomeCurto, ip }));
      log(`Verificando ${host}...`);

      const ping = await api.ping(host);
      setProgresso(0.4);
      setStatus("Ping realizado");

      if (!ping.online) {
        setInfo((i) => ({ ...i, status: "offline" }));
        limparInfoRustdesk();
        setProgresso(0);
        setStatus("Host offline");
        return null;
      }

      setInfo((i) => ({ ...i, status: "online" }));

      setProgresso(0.6);
      setStatus("Verificando RustDesk");

      const verificacao = await api.rustdeskVerificar(host);

      if (verificacao.instalado) {
        setInfo((i) => ({ ...i, rustdesk: "instalado", versao: verificacao.versao }));
        setInfo((i) => ({
          ...i,
          configuracao: verificacao.configurado ? "configurado" : "nao-configurado"
        }));

        const ultima = await api.rustdeskVersaoRepositorio();
        if (ultima) {
          const m = ultima.match(/(\d+(?:\.\d+)+)/);
          const versaoRepo = m ? m[1] : "";
          if (verificacao.versao.startsWith(versaoRepo)) {
            setInfo((i) => ({ ...i, atualizacao: "atualizado" }));
            setBtnInstalar({ texto: "Já Atualizado", disabled: true, variante: "success" });
          } else {
            setInfo((i) => ({ ...i, atualizacao: `disponivel:${versaoRepo}` }));
            setBtnInstalar({ texto: "Atualizar RustDesk", disabled: false, variante: "" });
          }
        }
      } else {
        setInfo((i) => ({
          ...i,
          rustdesk: "nao-encontrado",
          configuracao: "nao-aplicavel",
          versao: "Não instalado",
          atualizacao: "nao-instalado",
          usuarios: "Não consultado"
        }));
        setBtnInstalar({ texto: "Instalar RustDesk", disabled: false, variante: "" });
      }

      try {
        setProgresso(0.8);
        setStatus("Consultando usuários");
        const usuarios = await api.listarUsuarios(host);
        setInfo((i) => ({ ...i, usuarios: String(usuarios.length) }));
      } catch {
        setInfo((i) => ({ ...i, usuarios: "-" }));
      }

      setProgresso(1);
      setStatus("Verificação concluída");
      setTimeout(() => {
        setProgresso(0);
        setStatus("✅ Pronto para operação");
      }, 3000);

      return verificacao;
    },
    [log, ui]
  );

  // ------------------------- Consultar Usuários -------------------------
  const consultarUsuarios = async () => {
    const host = hostname.trim();
    if (!host) {
      await ui.mostrarMensagem("warning", "Hostname", "Informe um Hostname ou um IP.");
      setProgresso(0);
      setStatus("Operação cancelada");
      return;
    }

    log(`Consultando usuários de ${host}...`);
    const usuarios = await api.listarUsuarios(host);

    if (!usuarios.length) {
      log("[ERRO] Nenhum usuário encontrado.");
      return;
    }

    log(`[OK] ${usuarios.length} usuários encontrados.`);
    for (const usuario of usuarios) log(` - ${usuario}`);
  };

  // ------------------------- Configurar -------------------------
  const configurar = async () => {
    const host = hostname.trim();
    const senha = senhaRustdesk.trim();

    if (!host) {
      await ui.mostrarMensagem("warning", "Host", "Informe um Hostname ou um IP.");
      return;
    }
    if (!senha) {
      await ui.mostrarMensagem("warning", "Senha", "Informe uma senha.");
      return;
    }

    setOcupado(true);
    setStatus("Iniciando configuração...");
    setProgresso(0);

    try {
      const resultado = await api.rustdeskConfigurar(host, senha);

      if (!resultado || resultado.erro || !resultado.resumo) {
        const erro = resultado?.erro;
        if (erro === "nao-instalado") {
          await ui.mostrarMensagem(
            "warning",
            "RustDesk",
            "O RustDesk não está instalado nesta máquina.\n\nInstale o RustDesk antes de executar a configuração."
          );
          setInfo((i) => ({ ...i, configuracao: "nao-aplicavel" }));
        } else if (erro === "sem-usuarios") {
          await ui.mostrarMensagem(
            "warning",
            "Configuração",
            "Nenhum usuário foi carregado. Execute 'Consultar Usuários da Máquina' primeiro."
          );
        } else if (erro === "sem-credenciais") {
          await ui.mostrarMensagem(
            "warning",
            "Credenciais",
            "Credenciais administrativas não configuradas."
          );
        }
        setStatus("⚠ Falha na configuração");
        return;
      }

      const resumo = resultado.resumo;

      registrarHistorico(host, "Configuração", "Sucesso");
      setStatus("✅ Configuração concluída");
      setInfo((i) => ({ ...i, configuracao: "configurado" }));

      await ui.mostrarMensagem(
        "success",
        "Resumo",
        `Hostname: ${resumo.hostname}\n\n` +
          `Usuários encontrados: ${resumo.total}\n` +
          `Sucesso: ${resumo.sucesso}\n` +
          `Falhas: ${resumo.falha}\n\n` +
          `Senha aplicada: ${resumo.senha}\n` +
          `Servidor: ${resumo.servidor}`
      );

      await verificarMaquina(host);
    } finally {
      setOcupado(false);
    }
  };

  // ------------------------- Instalar -------------------------
  const instalar = async () => {
    const host = hostname.trim();
    if (!host) {
      await ui.mostrarMensagem("warning", "Host", "Informe um Hostname ou um IP.");
      return;
    }

    setOcupado(true);
    setStatus("Instalação iniciada...");
    try {
      const ok = await api.rustdeskInstalar(host);
      if (ok) {
        registrarHistorico(host, "Instalação/Atualização", "Sucesso");
        await ui.mostrarMensagem(
          "success",
          "RustDesk",
          "Instalação/Atualização concluída com sucesso."
        );
        setStatus("✅ Instalação concluída");
      } else {
        registrarHistorico(host, "Instalação/Atualização", "Falha");
        setStatus("⚠ Falha na instalação");
      }
      await verificarMaquina(host);
    } finally {
      setOcupado(false);
    }
  };

  // ------------------------- Desinstalar -------------------------
  const desinstalar = async () => {
    const host = hostname.trim();
    if (!host) {
      await ui.mostrarMensagem("warning", "Hostname", "Informe um Hostname ou um IP.");
      return;
    }

    const resposta = await ui.mostrarDialog({
      tipo: "confirm",
      titulo: "RustDesk",
      mensagem: "Deseja desinstalar completamente o RustDesk?"
    });
    if (!resposta) return;

    log(`[INFO] Iniciando desinstalação em ${host}`);
    setStatus("Removendo RustDesk...");
    setOcupado(true);

    try {
      const ok = await api.rustdeskDesinstalar(host);

      if (ok) {
        registrarHistorico(host, "Desinstalação", "Sucesso");
        setInfo((i) => ({
          ...i,
          rustdesk: "nao-encontrado",
          configuracao: "nao-aplicavel",
          versao: "Não instalado",
          atualizacao: "nao-instalado"
        }));
        setBtnInstalar({ texto: "Instalar RustDesk", disabled: false, variante: "" });
      } else {
        registrarHistorico(host, "Desinstalação", "Falha");
      }

      await verificarMaquina(host);
    } finally {
      setOcupado(false);
    }
  };

  const acaoProtegida = (fn: () => Promise<void>) => async () => {
    if (ocupado) return;
    if (!(await validarCredencial())) return;
    await fn();
  };

  const rotuloRustdesk =
    info.rustdesk === "instalado"
      ? "✅ Instalado"
      : info.rustdesk === "nao-encontrado"
        ? "❌ Não encontrado"
        : "-";

  const rotuloConfiguracao =
    info.configuracao === "configurado"
      ? "✅ Configurado"
      : info.configuracao === "nao-configurado"
        ? "⚠ Não Configurado"
        : info.configuracao === "nao-aplicavel"
          ? "⚠ Não Aplicável"
          : "-";

  const rotuloAtualizacao =
    info.atualizacao === "atualizado"
      ? "✅ Atualizado"
      : info.atualizacao === "nao-instalado"
        ? "Não Instalado"
        : info.atualizacao.startsWith("disponivel")
          ? `⬆ Disponível: ${info.atualizacao.split(":")[1]}`
          : "-";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, height: "100%" }}>
      {/* Formulário + Informações */}
      <div className="grid" style={{ gridTemplateColumns: "1.1fr 1fr" }}>
        <div className="card">
          <div className="card-title">
            <IconSettings size={16} /> Operação Remota
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="field">
              <label>Hostname ou IP</label>
              <input
                className="input"
                value={hostname}
                onChange={(e) => setHostname(e.target.value)}
                placeholder="Ex: PC-LAB01 ou 10.149.1.5"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !ocupado) {
                    setOcupado(true);
                    void verificarMaquina().finally(() => setOcupado(false));
                  }
                }}
              />
            </div>
            <div className="field">
              <label>Senha do Rustdesk</label>
              <input
                className="input"
                type="password"
                value={senhaRustdesk}
                onChange={(e) => setSenhaRustdesk(e.target.value)}
              />
            </div>
            <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <button
                className="btn secondary lg"
                disabled={ocupado}
                onClick={() => {
                  if (ocupado) return;
                  setOcupado(true);
                  void consultarUsuarios().finally(() => setOcupado(false));
                }}
              >
                <IconSearch size={16} /> Consultar Usuários
              </button>
              <button
                className="btn secondary lg"
                disabled={ocupado}
                onClick={() => {
                  if (ocupado) return;
                  setOcupado(true);
                  void verificarMaquina().finally(() => setOcupado(false));
                }}
              >
                <IconActivity size={16} /> Verificar Máquina
              </button>
            </div>
            <button className="btn lg block" disabled={ocupado} onClick={() => {
              if (ocupado) return;
              setOcupado(true);
              void acaoProtegida(configurar)().finally(() => setOcupado(false));
            }}>
              <IconSettings size={16} /> Configurar
            </button>
            <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <button
                className={`btn lg ${btnInstalar.variante}`}
                disabled={ocupado || btnInstalar.disabled}
                onClick={() => {
                  if (ocupado) return;
                  setOcupado(true);
                  void acaoProtegida(instalar)().finally(() => setOcupado(false));
                }}
              >
                <IconPackage size={16} /> {btnInstalar.texto}
              </button>
              <button
                className="btn danger lg"
                disabled={ocupado}
                onClick={() => {
                  if (ocupado) return;
                  setOcupado(true);
                  void acaoProtegida(desinstalar)().finally(() => setOcupado(false));
                }}
              >
                <IconTrash size={16} /> Desinstalar RustDesk
              </button>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-title">
            <IconGlobe size={16} /> Informações da Máquina
          </div>
          <div className="info-list">
            <div
              className="info-item clickable"
              onClick={() => copiar(info.hostname, "Hostname")}
              title="Clique para copiar"
            >
              <IconTag size={15} />
              <span className="label">Hostname:</span>
              <span className="value">{info.hostname}</span>
              <IconCopy size={13} style={{ marginLeft: "auto", color: "var(--faint)" }} />
            </div>
            <div
              className="info-item clickable"
              onClick={() => copiar(info.ip, "IP")}
              title="Clique para copiar"
            >
              <IconGlobe size={15} />
              <span className="label">IP:</span>
              <span className="value">{info.ip}</span>
              <IconCopy size={13} style={{ marginLeft: "auto", color: "var(--faint)" }} />
            </div>
            <div className="info-item">
              <IconActivity size={15} />
              <span className="label">Status:</span>
              <span
                className="value"
                style={{
                  color:
                    info.status === "online"
                      ? "var(--success)"
                      : info.status === "offline"
                        ? "var(--danger)"
                        : undefined
                }}
              >
                {info.status === "online"
                  ? "✅ Online"
                  : info.status === "offline"
                    ? "❌ Offline"
                    : "-"}
              </span>
            </div>
            <div className="info-item">
              <IconPackage size={15} />
              <span className="label">RustDesk:</span>
              <span
                className="value"
                style={{
                  color:
                    info.rustdesk === "instalado"
                      ? "var(--success)"
                      : info.rustdesk === "nao-encontrado"
                        ? "var(--danger)"
                        : undefined
                }}
              >
                {rotuloRustdesk}
              </span>
            </div>
            <div className="info-item">
              <IconSettings size={15} />
              <span className="label">Configuração:</span>
              <span
                className="value"
                style={{
                  color:
                    info.configuracao === "configurado"
                      ? "var(--success)"
                      : info.configuracao === "-"
                        ? undefined
                        : "var(--warning)"
                }}
              >
                {rotuloConfiguracao}
              </span>
            </div>
            <div className="info-item">
              <IconTag size={15} />
              <span className="label">Versão:</span>
              <span className="value">{info.versao}</span>
            </div>
            <div className="info-item">
              <IconRefresh size={15} />
              <span className="label">Atualização:</span>
              <span
                className="value"
                style={{
                  color:
                    info.atualizacao === "atualizado"
                      ? "var(--success)"
                      : info.atualizacao.startsWith("disponivel")
                        ? "var(--warning)"
                        : undefined
                }}
              >
                {rotuloAtualizacao}
              </span>
            </div>
            <div className="info-item">
              <IconUsers size={15} />
              <span className="label">Usuários (C:):</span>
              <span className="value">{info.usuarios}</span>
            </div>
            <div className="info-item">
              <IconKey size={15} />
              <span className="label">Servidor:</span>
              <span className="value">23.21.220.60</span>
            </div>
            <div className="info-item">
              <IconShield size={15} />
              <span className="label">Auditoria:</span>
              <span className="value" style={{ fontSize: 11.5, color: "var(--muted)" }}>
                registrar operações remotas
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Progresso */}
      <div className="card status-row">
        <div className="status-text" style={{ minWidth: 260 }}>
          {status}
        </div>
        <div className="progress">
          <div style={{ width: `${Math.round(progresso * 100)}%` }} />
        </div>
        <div className="percent">{Math.round(progresso * 100)}%</div>
        <IconPlay size={14} style={{ color: "var(--faint)" }} />
      </div>

      {/* Logs + Histórico */}
      <div className="grid" style={{ gridTemplateColumns: "2fr 1fr", flex: 1, minHeight: 0 }}>
        <div className="card" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div className="card-title">Logs</div>
          <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
            <LogBox linhas={logs} />
          </div>
        </div>
        <div className="card" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div className="card-title">Histórico</div>
          <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
            <div className="log-box">
              {historico.map((h, i) => (
                <div key={i} className="log-line lvl-info" style={{ marginBottom: 4 }}>
                  {h}
                </div>
              ))}
              {!historico.length && (
                <div className="log-line" style={{ color: "var(--faint)" }}>
                  Nenhuma operação registrada nesta sessão.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
