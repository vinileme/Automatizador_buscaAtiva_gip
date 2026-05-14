# Automatizador GIP — Desktop App

App desktop (Electron) que automatiza a coleta de alunos ausentes no GIP/Eduquest
e gera uma planilha consolidada por empresa.

UI no estilo **Liquid Glass / Apple Crystal**: vidro translúcido com acrylic no
Windows 11 e vibrancy no macOS, gradientes vivos, e cantos arredondados.

## Funcionalidades

- **Login**: e-mail e senha guardados localmente (senha criptografada via DPAPI no
  Windows / Keychain no macOS, usando `safeStorage` do Electron).
- **Turmas**: lista de turmas salva entre execuções. Adicione, remova, ou limpe tudo.
- **Executar**: roda a automação Playwright contra o sistema, com progresso em tempo
  real e log dentro do app.
- **Planilha**: botão para abrir o `.xlsx` gerado direto do app, ou mostrar no
  Explorer/Finder.

## Estrutura

```
electron/
  main.cjs         # processo principal (janela, IPC, persistência, automação)
  preload.cjs      # ponte segura para o renderer (window.api)
renderer/
  index.html       # UI (sidebar, executar, turmas, conta)
  styles.css       # tema Liquid Glass
  app.js           # interações + comunicação com main
scripts/
  gip-presencas.mjs  # automação Playwright (CLI + função exportada `runAutomation`)
```

Os dados do usuário ficam em:

- **Windows**: `%APPDATA%/Automatizador GIP/`
- **macOS**:   `~/Library/Application Support/Automatizador GIP/`

Arquivos persistidos:

- `settings.json` — e-mail, lista de turmas, último xlsx gerado, preferências.
- `password.enc`  — senha criptografada (não-legível fora desta máquina/usuário).

## Como rodar (desenvolvimento)

```bash
npm install
npm start
```

Na primeira execução, o Electron baixa o Chromium dele próprio; a **automação**,
no entanto, abre o **Chrome instalado no sistema** (canal `chrome`). Tenha o
Google Chrome instalado.

## Como gerar os executáveis

O app suporta **Windows, macOS (Apple Silicon e Intel) e Linux**:

```bash
npm run dist:win     # Windows x64 → .exe (NSIS)
npm run dist:mac     # macOS arm64 + x64 → .dmg
npm run dist:linux   # Linux x64 → .AppImage (portátil, qualquer distro)
npm run dist:all     # todos de uma vez
```

Os arquivos vão para `dist/`:

| Plataforma            | Arquivo                                       | Tamanho |
| --------------------- | --------------------------------------------- | ------- |
| Windows x64           | `Automatizador-GIP-Setup-1.0.0.exe`           | ~85 MB  |
| macOS Apple Silicon   | `Automatizador-GIP-1.0.0-arm64.dmg`           | ~103 MB |
| macOS Intel           | `Automatizador-GIP-1.0.0-x64.dmg`             | ~107 MB |
| Linux x64             | `Automatizador-GIP-1.0.0-x86_64.AppImage`     | ~112 MB |

### Como instalar/usar em cada SO

**Windows**: clique duas vezes no `.exe`, siga o instalador. Atalhos no Menu
Iniciar e área de trabalho. Como não está assinado com certificado pago, o
SmartScreen pode pedir confirmação: **Mais informações → Executar mesmo assim**.

**macOS**: monte o `.dmg`, arraste para Applications. Primeira vez: clique com
o botão direito → **Abrir** (porque não tem Developer ID Apple). Use o
`-arm64.dmg` para Macs M1/M2/M3/M4, e o `-x64.dmg` para Macs Intel.

**Linux**: `chmod +x Automatizador-GIP-*.AppImage` e dê duplo-clique. Não
precisa instalar nada — funciona em qualquer distro moderna (Ubuntu, Fedora,
Arch, Debian, etc.).

> **Cross-build**: construir todos os SOs a partir do macOS funciona (foi assim
> que esses binários foram gerados). Em uma máquina Windows, `dist:mac` e
> `dist:linux` podem precisar de Docker/WSL. Para uma build totalmente limpa
> por SO, prefira rodar cada `dist:*` na máquina daquele SO.

## Como publicar uma nova versão

O app consulta automaticamente o GitHub Releases do repositório
[vinileme/Automatizador_buscaAtiva_gip](https://github.com/vinileme/Automatizador_buscaAtiva_gip)
e avisa o usuário quando há uma versão nova. Para publicar uma:

1. **Subir o número da versão** em [package.json](package.json):
   ```json
   "version": "1.0.1"
   ```
2. **Gerar os binários**:
   ```bash
   npm run dist:all
   ```
   Vai criar `dist/Automatizador-GIP-Setup-1.0.1.exe`,
   `dist/Automatizador-GIP-1.0.1-arm64.dmg`,
   `dist/Automatizador-GIP-1.0.1-x64.dmg` e
   `dist/Automatizador-GIP-1.0.1-x86_64.AppImage`.
3. **Criar a Release no GitHub**:
   - Vai em **Releases → Draft a new release**.
   - Tag: `v1.0.1` (com o `v` na frente — o app aceita os dois formatos).
   - Anexa os 4 arquivos de `dist/`.
   - Publica.
4. **Pronto**. Apps já instalados, na próxima vez que abrirem, vão:
   - Mostrar um toast "Nova versão v1.0.1 disponível".
   - Acender uma bolinha no chip de versão no canto inferior-esquerdo.
   - Ao clicar no chip, abrir a página da release no navegador para o usuário
     baixar e instalar manualmente.

Quem ainda estiver na versão antiga não é forçado a atualizar — quando quiser,
clica no chip de versão e baixa.

## Uso (passo-a-passo)

1. Abra o app.
2. Vá em **Conta** e informe e-mail + senha. Salve.
3. Vá em **Turmas** e cadastre as turmas (código + empresa). Elas ficam salvas.
4. Volte para **Executar** e clique em **Iniciar automação**.
5. Ao concluir, clique em **Abrir planilha** (ou **Mostrar no Explorer**).

### Modo "login manual"

Em **Conta**, ative *Login manual* se preferir que o app apenas clique no botão
"Fazer login com o Google" e deixe você digitar e-mail e senha (útil para casos
com 2FA estrita).

## CLI (modo antigo)

O script continua executável como CLI para integrações/CRON:

```bash
GIP_EMAIL=stephanie.silva@alicerceedu.com.br GIP_PASSWORD=... npm run gip
```

Veja `.env.example` para variáveis suportadas.
