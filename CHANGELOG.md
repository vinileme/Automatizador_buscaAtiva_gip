# Changelog

Todas as mudanças notáveis do Automatizador de busca ativa — GIP serão documentadas aqui.

O formato é baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/)
e o projeto segue [Semantic Versioning](https://semver.org/lang/pt-BR/).

## [Não publicado]

## [1.0.0] - 2026-05-14

### Adicionado

- **App desktop multiplataforma** (Windows / macOS / Linux) baseado em Electron 33.
- **UI Liquid Glass** estilo Apple Crystal: acrylic no Windows 11, vibrancy no macOS,
  gradientes vivos e responsividade completa (sidebar vira barra de ícones em
  janelas estreitas e barra horizontal em telas muito pequenas).
- **Aba Conta**: e-mail + senha. Senha criptografada localmente via `safeStorage`
  do Electron (DPAPI no Windows, Keychain no macOS).
- **Aba Turmas**: cadastro de turmas (código + empresa). Lista persistida
  automaticamente entre execuções.
- **Aba Executar**: botão de iniciar com progresso ao vivo, log em tempo real,
  cancelamento gracioso e botão para abrir a planilha gerada.
- **Automação** Playwright/Chrome encapsulada em `runAutomation()` exportável,
  reaproveitando todo o fluxo do script original (login Google → busca turma →
  presença → coleta de ausentes e telefones → planilha Excel consolidada por
  empresa).
- **Notificação de atualizações** consultando o GitHub Releases na inicialização:
  bolinha de aviso na sidebar + toast quando há nova versão; clique abre a página
  de download.
- **CLI antiga preservada** (`npm run gip`) para uso via cron/terminal.
- **Workflow do GitHub Actions** que builda + publica releases nos 3 SOs ao
  empurrar uma tag `v*`.

### Distribuído

| Plataforma | Arquivo |
|---|---|
| Windows x64 | `Automatizador-GIP-Setup-1.0.0.exe` |
| macOS Apple Silicon | `Automatizador-GIP-1.0.0-arm64.dmg` |
| macOS Intel | `Automatizador-GIP-1.0.0-x64.dmg` |
| Linux x64 | `Automatizador-GIP-1.0.0-x86_64.AppImage` |

[Não publicado]: https://github.com/vinileme/Automatizador_buscaAtiva_gip/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/vinileme/Automatizador_buscaAtiva_gip/releases/tag/v1.0.0
