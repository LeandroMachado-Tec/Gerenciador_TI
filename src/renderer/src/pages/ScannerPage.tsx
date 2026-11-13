import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, AppInfo } from "../api";
import { useUI } from "../components/ui";
import { useCredencial } from "../App";
import {
  estiloBadge,
  SCANNER_COLUNAS,
  SCANNER_COLUNAS_OBRIGATORIAS,
  SCANNER_ESTATISTICAS,
  Dispositivo
} from "@shared";
import {
  IconActivity,
  IconCheck,
  IconClock,
  IconGlobe,
  IconLaptop,
  IconMonitor,
  IconPlay,
  IconRefresh,
  IconScan,
  IconSettings,
  IconSquare,
  IconTag,
  IconUsers
} from "../components/Icons";

const COLUNAS_MAP = new Map(SCANNER_COLUNAS.map((c) => [c.id, c]));

const ICONES_STATS: Record<string, React.ReactNode> = {
  total: <IconMonitor size={18} />,
  online: <IconActivity size={18} />,
  offline: <IconSquare size={18} />,
  rustdesk: <IconLaptop size={18} />,
  configurados: <IconSettings size={18} />,
  atualizacao: <IconRefresh size={18} />,
  usuarios: <IconUsers size={18} />
};

function ipChave(ip: string): number {
  const partes = ip.split(".").map((p) => parseInt(p, 10));
  if (partes.length !== 4 || partes.some((p) => Number.isNaN(p))) return -1;
  return ((partes[0] << 24) >>> 0) + (partes[1] << 16) + (partes[2] << 8) + partes[3];
}

function validarDigitacaoIp(texto: string): boolean {
  if (!texto) return true;
  const partes = texto.split(".");
  if (partes.length > 4) return false;
  for (const parte of partes) {
    if (!parte) continue;
    if (!/^\d{1,3}$/.test(parte) || parseInt(parte, 10) > 255) return false;
  }
  return true;
}

export function ScannerPage() {
  const ui = useUI();
  const { validarCredencial } = useCredencial();

  const [info, setInfo] = useState<AppInfo | null>(null);
  const [modo, setModo] = useState<"faixa" | "cidr">("faixa");
  const [ipBase, setIpBase] = useState("");
  const [cidr, setCidr] = useState(24);
  const [inicio, setInicio] = useState("");
  const [fim, setFim] = useState("");
  const [colunas, setColunas] = useState<string[]>(SCANNER_COLUNAS.map((c) => c.id));
  const [modalColunas, setModalColunas] = useState(false);
  const [dispositivos, setDispositivos] = useState<Map<string, Dispositivo>>(new Map());
  const [progresso, setProgresso] = useState(0);
  const [textoProgresso, setTextoProgresso] = useState("Preparando varredura...");
  const [emExecucao, setEmExecucao] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const [relogio, setRelogio] = useState(() => new Date().toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }));

  const colunasRef = useRef(colunas);
  colunasRef.current = colunas;

  useEffect(() => {
    void api.info().then((i) => {
      setInfo(i);
      const prefixo = (i.ipLocal || "").split(".").slice(0, 3).join(".");
      if (prefixo) {
        setIpBase(`${prefixo}.0`);
        setInicio(`${prefixo}.1`);
        setFim(`${prefixo}.254`);
      }
    });
    void api.scannerColunasObter().then(setColunas);
  }, []);

  useEffect(() => {
    const intervalo = setInterval(
      () =>
        setRelogio(
          new Date().toLocaleString("pt-BR", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit"
          })
        ),
      30000
    );
    return () => clearInterval(intervalo);
  }, []);

  const limparTabela = useCallback(() => {
    setDispositivos(new Map());
  }, []);

  useEffect(() => {
    const offDisp = api.onScannerDispositivo((e) => {
      setDispositivos((mapa) => {
        const novo = new Map(mapa);
        novo.set(e.dispositivo.ip, e.dispositivo);
        return novo;
      });
    });

    const offUpd = api.onScannerAtualizar((e) => {
      setDispositivos((mapa) => {
        const atual = mapa.get(e.ip);
        if (!atual) return mapa;
        const novo = new Map(mapa);
        novo.set(e.ip, { ...atual, ...e.info });
        return novo;
      });
    });

    const offProg = api.onScannerProgresso((e) => {
      setProgresso(Math.max(0, Math.min(1, e.fracao)));
      setTextoProgresso(e.texto);
    });

    const offLimpar = api.onScannerLimpar(() => limparTabela());

    const offFinal = api.onScannerFinalizado((e) => {
      setEmExecucao(false);
      setCancelando(false);
      if (e.cancelado) {
        limparTabela();
        setProgresso(0);
        setTextoProgresso("⛔ Varredura cancelada pelo usuário.");
      }
    });

    const offEstado = api.onScannerEstado((e) => setEmExecucao(e.emExecucao));

    const offErro = api.onScannerErro((e) => {
      void ui.mostrarMensagem("warning", "IP Scanner", e.erro);
    });

    return () => {
      offDisp();
      offUpd();
      offProg();
      offLimpar();
      offFinal();
      offEstado();
      offErro();
    };
  }, [limparTabela, ui]);

  const colunasVisiveis = useMemo(
    () => SCANNER_COLUNAS.filter((c) => colunas.includes(c.id)),
    [colunas]
  );

  const lista = useMemo(() => {
    return [...dispositivos.values()].sort((a, b) => {
      const ia = ipChave(a.ip);
      const ib = ipChave(b.ip);
      if (ia === -1 || ib === -1) return a.ip.localeCompare(b.ip);
      return ia - ib;
    });
  }, [dispositivos]);

  const estatisticas = useMemo(() => {
    const valores = {
      total: dispositivos.size,
      online: 0,
      offline: 0,
      rustdesk: 0,
      configurados: 0,
      atualizacao: 0,
      usuarios: 0
    };
    for (const d of dispositivos.values()) {
      if (d.status === "Online") valores.online++;
      if (d.rustdesk === "Sim") valores.rustdesk++;
      if (d.configurado === "Sim") valores.configurados++;
      if (String(d.atualizacao).startsWith("Sim")) valores.atualizacao++;
      const u = parseInt(d.usuarios, 10);
      if (!Number.isNaN(u)) valores.usuarios += u;
    }
    valores.offline = valores.total - valores.online;
    return valores;
  }, [dispositivos]);

  const iniciar = async () => {
    if (emExecucao) return;

    // Validação local dos campos
    const camposOk =
      modo === "faixa"
        ? validarDigitacaoIp(inicio) && validarDigitacaoIp(fim) && inicio && fim
        : validarDigitacaoIp(ipBase) && ipBase;
    if (!camposOk) {
      await ui.mostrarMensagem(
        "warning",
        "IP Scanner",
        "Preencha os campos com IPs válidos no formato x.x.x.x."
      );
      return;
    }

    if (!(await validarCredencial())) return;

    const ok = await api.scannerIniciar({
      modo,
      ipBase: modo === "cidr" ? ipBase.trim() : undefined,
      cidr: modo === "cidr" ? cidr : undefined,
      inicio: modo === "faixa" ? inicio.trim() : undefined,
      fim: modo === "faixa" ? fim.trim() : undefined,
      colunas: colunasRef.current
    });

    if (ok) {
      setEmExecucao(true);
      setCancelando(false);
    }
  };

  const cancelar = () => {
    setCancelando(true);
    void api.scannerCancelar();
  };

  const alternar = () => {
    if (emExecucao) {
      if (cancelando) return;
      cancelar();
    } else {
      void iniciar();
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, height: "100%" }}>
      {/* Cabeçalho */}
      <div className="page-header">
        <div className="page-icon">
          <IconMonitor size={26} />
        </div>
        <div>
          <h1>IP Scanner</h1>
          <p>Escaneie sua rede e descubra informações dos dispositivos</p>
        </div>
        <div className="page-tag">SIMPLES • RÁPIDO • COMPLETO</div>
      </div>

      {/* Faixa de IP */}
      <div className="card">
        <div className="card-title">
          <IconGlobe size={16} /> Rede / Faixa de IP
        </div>
        <div
          className="grid"
          style={{ gridTemplateColumns: "170px 1fr auto", alignItems: "end" }}
        >
          <div className="field">
            <label>Modo</label>
            <select
              className="select"
              value={modo}
              onChange={(e) => setModo(e.target.value as "faixa" | "cidr")}
              disabled={emExecucao}
            >
              <option value="faixa">Faixa de IP</option>
              <option value="cidr">CIDR</option>
            </select>
          </div>

          {modo === "faixa" ? (
            <>
              <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <div className="field">
                  <label>IP Inicial</label>
                  <input
                    className="input"
                    value={inicio}
                    onChange={(e) => {
                      if (validarDigitacaoIp(e.target.value)) setInicio(e.target.value);
                    }}
                    placeholder="Ex: 10.149.1.1"
                    disabled={emExecucao}
                  />
                </div>
                <div className="field">
                  <label>IP Final</label>
                  <input
                    className="input"
                    value={fim}
                    onChange={(e) => {
                      if (validarDigitacaoIp(e.target.value)) setFim(e.target.value);
                    }}
                    placeholder="Ex: 10.149.1.254"
                    disabled={emExecucao}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void iniciar();
                    }}
                  />
                </div>
              </div>
            </>
          ) : (
            <div className="grid" style={{ gridTemplateColumns: "1fr 140px" }}>
              <div className="field">
                <label>IP que será usado</label>
                <input
                  className="input"
                  value={ipBase}
                  onChange={(e) => {
                    if (validarDigitacaoIp(e.target.value)) setIpBase(e.target.value);
                  }}
                  placeholder="Ex: 10.149.1.0"
                  disabled={emExecucao}
                />
              </div>
              <div className="field">
                <label>CIDR</label>
                <select
                  className="select"
                  value={cidr}
                  onChange={(e) => setCidr(parseInt(e.target.value, 10))}
                  disabled={emExecucao}
                >
                  {Array.from({ length: 33 }, (_, i) => (
                    <option key={i} value={i}>
                      /{i}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: 10 }}>
            <button
              className="btn secondary lg"
              onClick={() => setModalColunas(true)}
              disabled={emExecucao}
            >
              <IconSettings size={16} /> Configurações
            </button>
            <button
              className={`btn lg ${emExecucao ? "danger" : ""}`}
              onClick={alternar}
              disabled={cancelando}
              style={{ minWidth: 200 }}
            >
              {emExecucao ? (
                <>
                  <IconSquare size={15} /> {cancelando ? "Cancelando..." : "Cancelar"}
                </>
              ) : (
                <>
                  <IconPlay size={15} /> Iniciar Varredura
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Tabela */}
      <div className="table-wrap">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "12px 16px 8px",
            gap: 10
          }}
        >
          <IconScan size={16} />
          <strong style={{ fontSize: 14.5 }}>Dispositivos Encontrados</strong>
          <span style={{ marginLeft: "auto", color: "var(--muted)", fontSize: 12.5 }}>
            Total: {dispositivos.size} dispositivos
          </span>
        </div>
        <div className="table-scroll">
          {lista.length === 0 ? (
            <div className="empty-state">
              <IconScan size={28} />
              <div>
                Nenhum dispositivo encontrado.
                <br />
                Inicie uma varredura para listar os dispositivos da rede.
              </div>
            </div>
          ) : (
            <table className="devices">
              <thead>
                <tr>
                  <th style={{ width: 46 }}>#</th>
                  {colunasVisiveis.map((c) => (
                    <th key={c.id} style={{ minWidth: c.larguraMin }}>
                      {c.titulo}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lista.map((d, indice) => (
                  <tr key={d.ip}>
                    <td style={{ color: "var(--muted)" }}>{indice + 1}</td>
                    {colunasVisiveis.map((c) => {
                      const valor = String((d as unknown as Record<string, unknown>)[c.id] ?? "-");
                      if (c.tipo === "badge") {
                        const { texto, cor } = estiloBadge(c.id, valor);
                        return (
                          <td key={c.id}>
                            {cor ? (
                              <span className="badge" style={{ background: cor }}>
                                {texto}
                              </span>
                            ) : (
                              <span style={{ color: "var(--faint)" }}>{texto}</span>
                            )}
                          </td>
                        );
                      }
                      return (
                        <td key={c.id} className={valor === "-" || valor === "N/A" ? "dim" : ""}>
                          {valor}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Estatísticas */}
      <div className="stats">
        {SCANNER_ESTATISTICAS.map((s) => (
          <div key={s.chave} className="stat-card">
            <div
              className="stat-icon"
              style={{ background: `${s.cor}22`, color: s.cor }}
            >
              {ICONES_STATS[s.chave]}
            </div>
            <div>
              <div className="stat-value">
                {estatisticas[s.chave as keyof typeof estatisticas]}
              </div>
              <div className="stat-label">{s.legenda}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Rodapé */}
      <div className="page-footer">
        <div className="status-text" style={{ minWidth: 260, flex: 1 }}>
          {textoProgresso}
        </div>
        <div className="progress" style={{ width: 340 }}>
          <div style={{ width: `${Math.round(progresso * 100)}%` }} />
        </div>
        <div className="percent">{Math.round(progresso * 100)}%</div>
        <div className="clock">
          <IconClock size={13} style={{ verticalAlign: -2, marginRight: 4 }} />
          {relogio}
        </div>
      </div>

      {modalColunas && (
        <ModalColunas
          colunas={colunas}
          aoSalvar={(novas) => {
            setColunas(novas);
            void api.scannerColunasSalvar(novas);
            setModalColunas(false);
          }}
          aoFechar={() => setModalColunas(false)}
        />
      )}
    </div>
  );
}

function ModalColunas({
  colunas,
  aoSalvar,
  aoFechar
}: {
  colunas: string[];
  aoSalvar: (colunas: string[]) => void;
  aoFechar: () => void;
}) {
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set(colunas));

  const alternar = (id: string) => {
    if (SCANNER_COLUNAS_OBRIGATORIAS.includes(id)) return;
    setSelecionadas((s) => {
      const novo = new Set(s);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  };

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ width: 500 }}>
        <div className="modal-head">
          <div className="modal-icon info">
            <IconCheck size={20} />
          </div>
          <h2>Colunas da Tabela</h2>
        </div>
        <div className="modal-body" style={{ whiteSpace: "normal" }}>
          <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
            Escolha quais colunas aparecerão na varredura.
            <br />
            IP e Hostname são obrigatórios.
          </div>
          <div
            style={{
              maxHeight: 320,
              overflow: "auto",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: 6
            }}
          >
            <div className="columns-grid">
              {SCANNER_COLUNAS.map((c) => {
                const obrigatoria = SCANNER_COLUNAS_OBRIGATORIAS.includes(c.id);
                const marcada = obrigatoria || selecionadas.has(c.id);
                return (
                  <label
                    key={c.id}
                    className={`check-row ${obrigatoria ? "disabled" : ""}`}
                    onClick={() => alternar(c.id)}
                  >
                    <input type="checkbox" checked={marcada} readOnly />
                    <span>
                      {c.titulo}
                      {obrigatoria ? " (obrigatória)" : ""}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn secondary" onClick={aoFechar}>
            Cancelar
          </button>
          <button className="btn" onClick={() => aoSalvar([...selecionadas])}>
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}
