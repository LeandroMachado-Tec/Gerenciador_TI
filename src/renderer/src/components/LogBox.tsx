import { useEffect, useRef } from "react";

export interface LinhaLog {
  id: number;
  texto: string;
  ts?: number;
  classe?: string;
}

export function nivelLinha(texto: string): string {
  const t = String(texto);
  if (t.startsWith("[ERRO]")) return "erro";
  if (t.startsWith("[OK]")) return "ok";
  if (t.startsWith("[INFO]")) return "info";
  if (t.startsWith("[AVISO]") || t.startsWith("====")) return "aviso";
  if (t.startsWith("[PING]")) return "ping";
  return "normal";
}

export function LogBox({
  linhas,
  className = "log-box"
}: {
  linhas: LinhaLog[];
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [linhas.length]);

  return (
    <div className={className} ref={ref}>
      {linhas.map((l) => (
        <div key={l.id} className={`log-line lvl-${l.classe || nivelLinha(l.texto)}`}>
          {l.ts ? <span className="ts">[{new Date(l.ts).toLocaleTimeString("pt-BR")}] </span> : null}
          {l.texto}
        </div>
      ))}
    </div>
  );
}
