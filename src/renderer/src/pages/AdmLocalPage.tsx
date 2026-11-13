import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useUI } from "../components/ui";
import { useCredencial } from "../App";
import { ADM_ACOES, ADM_ACOES_COM_SENHA, validarCamposAdm, validarNomeUsuario, analisarComputadores } from "@shared";
import { nivelLinha } from "../components/LogBox";
import {
  IconClock,
  IconMonitor,
  IconPlay,
  IconSettings,
  IconSquare,
  IconTrash,
  IconUserCog
} from "../components/Icons";

interface LinhaConsole {
  id: number;
  texto: string;
}

let contadorLinhas = 0;

export function AdmLocalPage() {
  const ui = useUI();
  const { validarCredencial } = useCredencial();

  const [acao, setAcao] = useState("Criar Usuário ADM");
  const [nomeUsuario, setNomeUsuario] = useState("");
  const [senhaUsuario, setSenhaUsuario] = useState("");
  const [computadores, setComputadores] = useState("");
  const [consoleLinhas, setConsoleLinhas] = useState<LinhaConsole[]>([]);
  const [status, setStatus] = useState("Pronto para executar.");
  const [emExecucao, setEmExecucao] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const [relogio, setRelogio] = useState(() =>
    new Date().toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    })
  );

  const emExecucaoRef = useRef(emExecucao);
  emExecucaoRef.current = emExecucao;
  const acaoRef = useRef(acao);
  acaoRef.current = acao;
  const nomeRef = useRef(nomeUsuario);
  nomeRef.current = nomeUsuario;
  const senhaRef = useRef(senhaUsuario);
  senhaRef.current = senhaUsuario;
  const compRef = useRef(computadores);
  compRef.current = computadores;

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

  useEffect(() => {
    const off = api.onAdmLinha((e) => {
      setConsoleLinhas((l) => [...l.slice(-1999), { id: ++contadorLinhas, texto: e.texto }]);
    });
    const offFim = api.onAdmFinalizado((r) => {
      setEmExecucao(false);
      setCancelando(false);
      if (r.sucesso) {
        setStatus(`✅ Operação concluída em ${r.processadas} máquina(s).`);
      } else {
        setStatus("⚠ Operação finalizada com erros. Verifique o console.");
      }
    });
    return () => {
      off();
      offFim();
    };
  }, []);

  useEffect(() => {
    setConsoleLinhas([
      {
        id: ++contadorLinhas,
        texto:
          "[INFO] Console pronto. As operações utilizam as credenciais armazenadas (⚙ Configurações > 🔑 Editar Credenciais)."
      }
    ]);
  }, []);

  const limparConsole = useCallback(() => setConsoleLinhas([]), []);

  const executar = async () => {
    if (emExecucaoRef.current) {
      if (!cancelando) {
        setCancelando(true);
        await api.admCancelar();
      }
      return;
    }

    const acaoAtual = acaoRef.current;
    const codigoAcao = ADM_ACOES[acaoAtual];

    // Confirmação específica da exclusão (como no Python)
    if (codigoAcao === "excluir") {
      const { nome, erro } = validarNomeUsuario(nomeRef.current);
      if (erro) {
        await ui.mostrarMensagem("warning", "ADM Local", erro);
        return;
      }
      const maquinas = analisarComputadores(compRef.current);
      if (!maquinas.length) {
        await ui.mostrarMensagem("warning", "ADM Local", "Informe ao menos um computador.");
        return;
      }
      const resposta = await ui.mostrarDialog({
        tipo: "confirm",
        titulo: "Confirmação",
        mensagem: `Tem certeza que deseja EXCLUIR o usuário ${nome} e APAGAR o perfil em:\n\n${maquinas.join(", ")}?`
      });
      if (!resposta) return;
    }

    if (!(await validarCredencial())) return;

    const { computadores: lista, erro } = validarCamposAdm(
      codigoAcao,
      nomeRef.current,
      senhaRef.current,
      compRef.current
    );

    if (erro) {
      await ui.mostrarMensagem("warning", "ADM Local", erro);
      return;
    }

    setEmExecucao(true);
    setCancelando(false);
    setStatus("Executando...");

    try {
      await api.admExecutar({
        acao: codigoAcao,
        nomeUsuario: nomeRef.current,
        senhaUsuario: senhaRef.current,
        computadores: lista || []
      });
    } catch {
      setEmExecucao(false);
      setCancelando(false);
      setStatus("⚠ Operação finalizada com erros. Verifique o console.");
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, height: "100%" }}>
      {/* Cabeçalho */}
      <div className="page-header">
        <div className="page-icon">
          <IconUserCog size={26} />
        </div>
        <div>
          <h1>Gerenciador ADM Local</h1>
          <p>Crie, altere ou remova administradores locais em máquinas remotas</p>
        </div>
        <div className="page-tag">REMOTO • CREDENCIAIS • AUTOMATIZADO</div>
      </div>

      {/* Formulário */}
      <div className="card">
        <div className="card-title">
          <IconSettings size={16} /> Dados da Operação
        </div>
        <div
          className="grid"
          style={{
            gridTemplateColumns: "200px 170px 170px 1fr auto",
            alignItems: "end"
          }}
        >
          <div className="field">
            <label>Ação</label>
            <select
              className="select"
              value={acao}
              onChange={(e) => setAcao(e.target.value)}
              disabled={emExecucao}
            >
              {Object.keys(ADM_ACOES).map((rotulo) => (
                <option key={rotulo} value={rotulo}>
                  {rotulo}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Usuário Local</label>
            <input
              className="input"
              value={nomeUsuario}
              onChange={(e) => setNomeUsuario(e.target.value)}
              placeholder="Ex: adm.local"
              disabled={emExecucao}
            />
          </div>
          <div className="field">
            <label>Senha</label>
            <input
              className="input"
              type="password"
              value={senhaUsuario}
              onChange={(e) => setSenhaUsuario(e.target.value)}
              placeholder="Senha do usuário local"
              disabled={emExecucao || !ADM_ACOES_COM_SENHA.includes(ADM_ACOES[acao])}
              style={{
                opacity: ADM_ACOES_COM_SENHA.includes(ADM_ACOES[acao]) ? 1 : 0.45
              }}
            />
          </div>
          <div className="field">
            <label>Computador(es)</label>
            <input
              className="input"
              value={computadores}
              onChange={(e) => setComputadores(e.target.value)}
              placeholder="Ex: PC01, PC02 ou 10.149.1.5"
              disabled={emExecucao}
            />
          </div>
          <button
            className={`btn lg ${emExecucao ? "danger" : ""}`}
            onClick={executar}
            disabled={cancelando}
            style={{ minWidth: 170 }}
          >
            {emExecucao ? (
              <>
                <IconSquare size={15} /> {cancelando ? "Cancelando..." : "Cancelar"}
              </>
            ) : (
              <>
                <IconPlay size={15} /> Executar
              </>
            )}
          </button>
        </div>
      </div>

      {/* Console */}
      <div className="card" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <div
          className="card-title"
          style={{ display: "flex", alignItems: "center", marginBottom: 10 }}
        >
          <IconMonitor size={16} /> Console de Operação
          <button
            className="btn secondary"
            style={{ marginLeft: "auto", height: 32, fontSize: 12.5 }}
            onClick={limparConsole}
          >
            <IconTrash size={14} /> Limpar
          </button>
        </div>
        <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
          <div className="console-box" style={{ flex: 1 }}>
            {consoleLinhas.map((l) => (
              <div key={l.id} className={`log-line lvl-${nivelLinha(l.texto)}`}>
                {l.texto}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Rodapé */}
      <div className="page-footer">
        <div className="status-text" style={{ flex: 1 }}>
          {status}
        </div>
        <div className="progress" style={{ width: 260 }}></div>
        <div className="clock">
          <IconClock size={13} style={{ verticalAlign: -2, marginRight: 4 }} />
          {relogio}
        </div>
      </div>
    </div>
  );
}
