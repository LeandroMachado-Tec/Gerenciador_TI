import { execFile } from "child_process";
import iconv from "iconv-lite";

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Executa um comando de forma oculta (sem janela de console),
 * equivalente ao executar_oculto/system_oculto do Python
 * (STARTF_USESHOWWINDOW + CREATE_NO_WINDOW).
 */
export function runCmd(
  comando: string,
  timeoutMs = 30000
): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(
      "cmd.exe",
      ["/d", "/s", "/c", comando],
      {
        windowsHide: true,
        timeout: timeoutMs,
        encoding: "buffer",
        maxBuffer: 10 * 1024 * 1024
      },
      (erro, stdout, stderr) => {
        const code =
          erro && typeof (erro as NodeJS.ErrnoException & { code?: unknown }).code === "number"
            ? ((erro as unknown as { code: number }).code)
            : erro
              ? 1
              : 0;
        resolve({
          code,
          stdout: iconv.decode(stdout as Buffer, "cp850"),
          stderr: iconv.decode(stderr as Buffer, "cp850")
        });
      }
    );
  });
}

/** Executa um executável com argumentos em array (sem shell), oculto. */
export function runExe(
  exe: string,
  args: string[],
  timeoutMs = 30000
): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(
      exe,
      args,
      {
        windowsHide: true,
        timeout: timeoutMs,
        encoding: "buffer",
        maxBuffer: 10 * 1024 * 1024
      },
      (erro, stdout, stderr) => {
        const code =
          erro && typeof (erro as NodeJS.ErrnoException & { code?: unknown }).code === "number"
            ? ((erro as unknown as { code: number }).code)
            : erro
              ? 1
              : 0;
        resolve({
          code,
          stdout: iconv.decode(stdout as Buffer, "cp850"),
          stderr: iconv.decode(stderr as Buffer, "cp850")
        });
      }
    );
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
