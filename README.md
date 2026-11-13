# Gerenciador de TI — TypeScript + Electron + Vite

Recriação do Gerenciador de Rustdesk (Python/CustomTkinter) em **TypeScript**, com interface
moderna (React + Vite) empacotada como aplicativo Windows (Electron).

> **Observação:** o Electron é necessário porque o programa executa comandos do Windows
> (`ping`, `net use`, `schtasks`, `sc`, `arp`, `nbtstat`, `wmic`, PowerShell) que um site
> puro no navegador não consegue executar.

## Funcionalidades (paridade com o original)

| Módulo | Funções |
| --- | --- |
| **Gerenciador RustDesk** | Consultar usuários (C$), Verificar máquina, Configurar (TOML para todos os perfis + LocalService + senha + reinício do serviço), Instalar/Atualizar (repositório de rede), Desinstalar (MSI/x86/WMIC/Registro), Histórico e Logs |
| **Credenciais** | Armazenamento criptografado (DPAPI/safeStorage), validação de logon de rede + permissão `admin$`, bloqueio de ADM local/domínio, alerta de senha expirada, revalidação a cada 30 min |
| **IP Scanner** | Varredura por Faixa de IP ou CIDR (60 threads), MAC/fabricante (ARP+OUI), hostname (DNS/NBT), RustDesk instalado/configurado/versão/atualização, usuários, serial (WMIC), colunas configuráveis, cancelamento |
| **ADM Local** | Criar usuário ADM, alterar senha, excluir usuário + perfil, consultar status — via C$ + `schtasks` remoto como SYSTEM, console colorido e cancelamento |
| **Auditoria** | `auditoria.log` e credenciais em `%APPDATA%/gerenciador-ti/` |

## Desenvolvimento

```bash
npm install
npm run dev        # abre o app com hot-reload
npm run typecheck  # verificação de tipos
```

## Gerar o .exe (instalador)

```bash
npm run dist            # instalador NSIS em release/<versao>/
npm run dist:portable   # .exe portátil (sem instalação)
```

- O instalador NSIS permite escolher a pasta, cria atalho na área de trabalho.
- O ícone está em `resources/icon.ico`.

## Atualização automática

Já implementada com `electron-updater` (o app verifica atualizações ao iniciar e baixa
automaticamente; instala ao fechar/reabrir). Para ativar:

1. Hospede as builds em algum servidor/servidor de arquivos (pasta HTTP, IIS, Nginx...)
2. Em `package.json`, troque a URL:

```json
"publish": [
  { "provider": "generic", "url": "https://SEU-SERVIDOR/updates/gerenciador-ti/" }
]
```

3. Publique novas versões com:

```bash
npm run dist
# envie release/<versao>/*.exe, *.blockmap e latest.yml para a URL acima
```

Também é possível usar GitHub Releases trocando o provider para `"github"`.

## Estrutura

```
app-ts/
├── electron.vite.config.ts      # Vite (main + preload + renderer)
├── resources/icon.ico
└── src/
    ├── shared/                  # tipos, constantes, geração de .bat (compartilhado)
    ├── main/                    # processo Electron (Node) — toda a lógica Windows
    │   ├── index.ts             # janela + atualização automática
    │   ├── ipc.ts               # canais IPC
    │   └── core/                # exec oculto, credenciais, rede, rustdesk, scanner, adm
    └── renderer/                # interface React (dark theme)
        └── src/
            ├── App.tsx          # layout, navegação, credenciais, modais
            └── pages/           # RustDesk, IP Scanner, ADM Local
```
