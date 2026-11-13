import { safeStorage, app } from "electron";
import { readFileSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";

const ARQUIVO = "credentials.bin";

function caminho(): string {
  return join(app.getPath("userData"), ARQUIVO);
}

/**
 * Gerenciador de credenciais — equivalente ao CredentialManager (keyring).
 * Armazena criptografado com DPAPI (safeStorage) no perfil do usuário.
 */
export function credSalvar(usuario: string, senha: string): void {
  const json = JSON.stringify({ usuario, senha });
  let payload: Buffer;
  if (safeStorage.isEncryptionAvailable()) {
    payload = safeStorage.encryptString(json);
  } else {
    payload = Buffer.concat([Buffer.from("PLAIN:"), Buffer.from(json, "utf8")]);
  }
  writeFileSync(caminho(), payload);
}

export function credObter(): { usuario: string | null; senha: string | null } {
  try {
    const buf = readFileSync(caminho());
    let json: string;
    if (buf.subarray(0, 6).toString("latin1") === "PLAIN:") {
      json = buf.subarray(6).toString("utf8");
    } else if (safeStorage.isEncryptionAvailable()) {
      json = safeStorage.decryptString(buf);
    } else {
      return { usuario: null, senha: null };
    }
    const obj = JSON.parse(json);
    return { usuario: obj.usuario ?? null, senha: obj.senha ?? null };
  } catch {
    return { usuario: null, senha: null };
  }
}

export function credRemover(): void {
  try {
    unlinkSync(caminho());
  } catch {
    /* ignora */
  }
}
