import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { IconAlert, IconCheck, IconInfo, IconX } from "./Icons";

// ------------------------------------------------------------------ //
// Diálogos e Toasts — sistema centralizado
// ------------------------------------------------------------------ //

export type DialogTipo = "info" | "warning" | "error" | "success" | "confirm";

export interface DialogOpcoes {
  tipo: DialogTipo;
  titulo: string;
  mensagem: string;
  okTexto?: string;
}

interface DialogAtivo extends DialogOpcoes {
  resolver: (valor: boolean) => void;
}

interface UICtx {
  mostrarDialog: (opcoes: DialogOpcoes) => Promise<boolean>;
  mostrarMensagem: (tipo: DialogTipo, titulo: string, mensagem: string) => Promise<void>;
  toast: (texto: string) => void;
}

const Ctx = createContext<UICtx>(null as unknown as UICtx);

export function useUI(): UICtx {
  return useContext(Ctx);
}

export function UIProvider({ children }: { children: React.ReactNode }) {
  const [dialogo, setDialogo] = useState<DialogAtivo | null>(null);
  const [toasts, setToasts] = useState<{ id: number; texto: string }[]>([]);
  const idRef = useRef(0);

  const mostrarDialog = useCallback((opcoes: DialogOpcoes) => {
    return new Promise<boolean>((resolver) => {
      setDialogo({ ...opcoes, resolver });
    });
  }, []);

  const mostrarMensagem = useCallback(
    async (tipo: DialogTipo, titulo: string, mensagem: string) => {
      await mostrarDialog({ tipo, titulo, mensagem, okTexto: "OK" });
    },
    [mostrarDialog]
  );

  const toast = useCallback((texto: string) => {
    const id = ++idRef.current;
    setToasts((t) => [...t, { id, texto }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  const fechar = (valor: boolean) => {
    dialogo?.resolver(valor);
    setDialogo(null);
  };

  const icone = () => {
    if (!dialogo) return null;
    if (dialogo.tipo === "error")
      return (
        <div className="modal-icon error">
          <IconX size={20} />
        </div>
      );
    if (dialogo.tipo === "warning")
      return (
        <div className="modal-icon warning">
          <IconAlert size={20} />
        </div>
      );
    if (dialogo.tipo === "success")
      return (
        <div className="modal-icon success">
          <IconCheck size={20} />
        </div>
      );
    return (
      <div className="modal-icon info">
        <IconInfo size={20} />
      </div>
    );
  };

  return (
    <Ctx.Provider value={{ mostrarDialog, mostrarMensagem, toast }}>
      {children}

      {dialogo && (
        <div className="modal-overlay">
          <div className="modal" style={{ width: 460 }}>
            <div className="modal-head">
              {icone()}
              <h2>{dialogo.titulo}</h2>
            </div>
            <div className="modal-body">{dialogo.mensagem}</div>
            <div className="modal-foot">
              {dialogo.tipo === "confirm" && (
                <button className="btn secondary" onClick={() => fechar(false)}>
                  Não
                </button>
              )}
              <button
                className={dialogo.tipo === "confirm" ? "btn" : "btn"}
                onClick={() => fechar(true)}
              >
                {dialogo.okTexto || (dialogo.tipo === "confirm" ? "Sim" : "OK")}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            {t.texto}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

// ------------------------------------------------------------------ //
// Modal genérico
// ------------------------------------------------------------------ //

export function Modal({
  titulo,
  icone,
  children,
  rodape,
  largura = 520,
  aoFechar
}: {
  titulo: string;
  icone?: React.ReactNode;
  children: React.ReactNode;
  rodape?: React.ReactNode;
  largura?: number;
  aoFechar?: () => void;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && aoFechar) aoFechar();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [aoFechar]);

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ width: largura }}>
        <div className="modal-head">
          {icone}
          <h2>{titulo}</h2>
        </div>
        <div className="modal-body">{children}</div>
        {rodape && <div className="modal-foot">{rodape}</div>}
      </div>
    </div>
  );
}
