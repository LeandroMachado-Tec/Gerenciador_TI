import { credObter } from "./credentials";
import { runCmd } from "./exec";

export interface CredencialValidacao {
  valido: boolean;
  motivo: string;
  usuario: string | null;
}

/**
 * Equivalente ao validar_permissao_administrativa:
 * testa o acesso ao compartilhamento administrativo admin$ da máquina local.
 */
async function validarPermissaoAdministrativa(senha: string, usuario: string): Promise<boolean> {
  const hostname = process.env.COMPUTERNAME || "";
  try {
    const resultado = await runCmd(`net use \\\\${hostname}\\admin$ "${senha}" /user:"${usuario}"`);
    await runCmd(`net use \\\\${hostname}\\admin$ /delete /y`);
    return resultado.code === 0;
  } catch {
    return false;
  }
}

/**
 * Equivalente ao validar_credencial_adm do gui.py:
 * valida formato do usuário (sem ADM local, domínio REDEDOR),
 * faz um logon de rede com as credenciais (LogonUser -> net use IPC$)
 * e verifica permissões administrativas.
 */
export async function validarCredencialAdm(): Promise<CredencialValidacao> {
  const { usuario, senha } = credObter();

  if (!usuario || !senha) {
    return { valido: false, motivo: "Nenhuma credencial cadastrada", usuario };
  }

  const usuarioLower = usuario.toLowerCase();
  const nomePc = (process.env.COMPUTERNAME || "").toLowerCase();

  if (usuarioLower.startsWith(".\\") || usuarioLower.startsWith("localhost\\")) {
    return { valido: false, motivo: "Administrador local não permitido", usuario };
  }

  if (nomePc && usuarioLower.startsWith(`${nomePc}\\`)) {
    return { valido: false, motivo: "Administrador local não permitido", usuario };
  }

  if (usuario.includes("\\")) {
    const dominio = usuario.split("\\")[0];
    if (dominio.toUpperCase() !== "REDEDOR") {
      return { valido: false, motivo: `Domínio não permitido: ${dominio}`, usuario };
    }
  }

  try {
    // Logon de rede (equivalente a LogonUser LOGON32_LOGON_NETWORK)
    const logon = await runCmd(`net use \\\\127.0.0.1\\IPC$ "${senha}" /user:"${usuario}" /persistent:no`);
    await runCmd(`net use \\\\127.0.0.1\\IPC$ /delete /y`);

    if (logon.code !== 0) {
      const texto = (logon.stdout + " " + logon.stderr).toLowerCase();
      const codigos = ["1326", "1327", "1328", "1329", "1330", "1331"];
      if (codigos.some((c) => texto.includes(c))) {
        return { valido: false, motivo: "Senha expirada ou credencial inválida", usuario };
      }
      return { valido: false, motivo: "Falha ao validar credencial", usuario };
    }

    if (!(await validarPermissaoAdministrativa(senha, usuario))) {
      return { valido: false, motivo: "Usuário sem permissões administrativas", usuario };
    }

    return { valido: true, motivo: "Credencial válida", usuario };
  } catch {
    return { valido: false, motivo: "Falha ao validar credencial", usuario };
  }
}
