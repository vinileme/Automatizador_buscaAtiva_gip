/**
 * Processo principal do Electron.
 *
 * Responsabilidades:
 *  - Criar a janela com visual "Liquid Glass" (acrylic no Windows, vibrancy no macOS).
 *  - Persistir configurações do usuário (email, turmas, caminho da última planilha).
 *  - Guardar a senha criptografada via safeStorage do Electron (DPAPI no Windows / Keychain no macOS).
 *  - Expor IPC para a UI: rodar/cancelar automação, abrir planilha, etc.
 *  - Importar dinamicamente o script ESM da automação e repassar logs/eventos para a UI.
 */
const { app, BrowserWindow, ipcMain, shell, safeStorage, dialog } = require("electron");
const path = require("node:path");
const fs  = require("node:fs");
const { appendAppLog } = require("./file-logger.cjs");

/**
 * Versão exibida e usada na checagem de updates.
 * `app.getVersion()` em dev pode não bater com o `package.json` (cwd / como o IDE
 * inicia o Electron); o manifesto ao lado de `main.cjs` é a fonte de verdade.
 */
function versaoDoManifesto() {
  try {
    const pkgPath = path.join(__dirname, "..", "package.json");
    const v = JSON.parse(fs.readFileSync(pkgPath, "utf8")).version;
    if (typeof v === "string" && v.trim()) return v.trim();
  } catch {
    /* usa fallback abaixo */
  }
  return app.getVersion();
}

// ── caminhos persistentes ──────────────────────────────────────────────────────
const userDataDir   = () => app.getPath("userData");
const settingsPath  = () => path.join(userDataDir(), "settings.json");
const passwordPath  = () => path.join(userDataDir(), "password.enc");

const DEFAULTS = {
  email: "",
  turmas: [],            // [{codigo, empresa}]
  ultimaPlanilha: null,  // caminho absoluto do último xlsx gerado
  manualGoogle: false,
  janela: { width: 1100, height: 760 },
};

function lerSettings() {
  try {
    const raw = fs.readFileSync(settingsPath(), "utf8");
    const obj = JSON.parse(raw);
    return { ...DEFAULTS, ...obj };
  } catch {
    return { ...DEFAULTS };
  }
}

function salvarSettings(parcial) {
  const atual  = lerSettings();
  const merged = { ...atual, ...parcial };
  fs.mkdirSync(userDataDir(), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(merged, null, 2), "utf8");
  return merged;
}

// ── senha criptografada (DPAPI no Windows) ────────────────────────────────────
function senhaDisponivel() {
  return fs.existsSync(passwordPath());
}

function salvarSenha(plain) {
  if (!plain) {
    if (fs.existsSync(passwordPath())) fs.unlinkSync(passwordPath());
    return false;
  }
  if (!safeStorage.isEncryptionAvailable()) {
    // Em último caso (sem keystore disponível), gravamos em texto-plano,
    // sinalizado por prefixo. Em uso normal no Windows isso não ocorre.
    fs.mkdirSync(userDataDir(), { recursive: true });
    fs.writeFileSync(passwordPath(), `PLAIN:${plain}`, "utf8");
    return true;
  }
  const enc = safeStorage.encryptString(plain);
  fs.mkdirSync(userDataDir(), { recursive: true });
  fs.writeFileSync(passwordPath(), enc);
  return true;
}

function lerSenha() {
  if (!senhaDisponivel()) return null;
  const buf = fs.readFileSync(passwordPath());
  const head = buf.slice(0, 6).toString("utf8");
  if (head === "PLAIN:") return buf.slice(6).toString("utf8");
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    return safeStorage.decryptString(buf);
  } catch {
    return null;
  }
}

// ── verificação de atualizações via GitHub Releases ──────────────────────────
const REPO = "vinileme/Automatizador_buscaAtiva_gip";
const GITHUB_LATEST_API   = `https://api.github.com/repos/${REPO}/releases/latest`;
const GITHUB_RELEASES_URL = `https://github.com/${REPO}/releases`;

/**
 * Compara strings de versão "x.y.z" (com ou sem prefixo "v").
 * @returns {number} 1 se a > b, -1 se a < b, 0 se iguais.
 */
function compararVersoes(a, b) {
  const parse = (s) =>
    String(s ?? "")
      .trim()
      .replace(/^v/i, "")
      .split(/[.\-+]/)
      .map((x) => parseInt(x, 10))
      .filter((n) => !Number.isNaN(n));
  const na = parse(a);
  const nb = parse(b);
  const len = Math.max(na.length, nb.length);
  for (let i = 0; i < len; i++) {
    const ai = na[i] ?? 0;
    const bi = nb[i] ?? 0;
    if (ai > bi) return 1;
    if (ai < bi) return -1;
  }
  return 0;
}

/**
 * Consulta a release mais recente no GitHub e compara com a versão atual do app.
 * Timeout de 8s para evitar travar a UI caso a rede esteja ruim.
 *
 * @returns {Promise<{ok:boolean, atual?:string, ultima?:string, hasUpdate?:boolean, htmlUrl?:string, reason?:string}>}
 */
async function checarUltimaRelease() {
  const atual = versaoDoManifesto();
  try {
    const res = await fetch(GITHUB_LATEST_API, {
      headers: {
        "User-Agent": "Automatizador-GIP",
        Accept: "application/vnd.github+json",
      },
      signal: AbortSignal.timeout(8000),
    });

    if (res.status === 404) {
      return { ok: true, atual, ultima: null, hasUpdate: false, reason: "Sem releases publicadas." };
    }
    if (res.status === 403) {
      return { ok: false, atual, reason: "Limite de requisições do GitHub atingido (tente mais tarde)." };
    }
    if (!res.ok) {
      return { ok: false, atual, reason: `GitHub respondeu ${res.status}.` };
    }

    const data = await res.json();
    const ultima  = data.tag_name || data.name || "";
    const htmlUrl = data.html_url || GITHUB_RELEASES_URL;
    const hasUpdate = compararVersoes(ultima, atual) > 0;
    return { ok: true, atual, ultima, hasUpdate, htmlUrl };
  } catch (err) {
    const reason = err?.name === "AbortError"
      ? "Tempo esgotado consultando GitHub."
      : (err?.message || "Falha de rede.");
    return { ok: false, atual, reason };
  }
}

// ── janela ────────────────────────────────────────────────────────────────────
let mainWindow = null;

function resolverIconePath() {
  // Em dev fica em <repo>/build/icon.png. Empacotado fica dentro de app.asar
  // no mesmo caminho relativo, pois "build/icon.png" está incluído em files[].
  const candidatos = [
    path.join(__dirname, "..", "build", "icon.png"),
    path.join(process.resourcesPath || "", "app.asar", "build", "icon.png"),
  ];
  for (const c of candidatos) {
    try { if (fs.existsSync(c)) return c; } catch {}
  }
  return undefined;
}

function criarJanela() {
  const settings = lerSettings();
  const { width = 1100, height = 760 } = settings.janela ?? {};
  const iconPath = resolverIconePath();

  mainWindow = new BrowserWindow({
    width,
    height,
    minWidth:  680,
    minHeight: 540,
    show: false,
    icon: iconPath,
    backgroundColor: process.platform === "darwin" ? "#00000000" : "#1A1B22",
    // Estilo Apple "Liquid Glass": titlebar embutida sem moldura tradicional.
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    titleBarOverlay:
      process.platform === "win32"
        ? { color: "#00000000", symbolColor: "#FFFFFF", height: 36 }
        : false,
    // Acrylic no Windows 11 (efeito vidro fosco translúcido).
    backgroundMaterial: process.platform === "win32" ? "acrylic" : undefined,
    // Vibrancy no macOS (mesmo efeito nativo).
    vibrancy: process.platform === "darwin" ? "under-window" : undefined,
    visualEffectState: "active",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: false, // precisamos do require("node:...") no preload
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));

  mainWindow.once("ready-to-show", () => mainWindow.show());

  mainWindow.on("close", () => {
    if (!mainWindow) return;
    const [w, h] = mainWindow.getSize();
    salvarSettings({ janela: { width: w, height: h } });
  });

  mainWindow.on("closed", () => { mainWindow = null; });
}

// ── automação ─────────────────────────────────────────────────────────────────
let runAtual = null; // { controller, promise }

function enviar(canal, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(canal, payload);
  }
}

function resolverAutomationPath() {
  // No dev e quando rodando sem empacotar, o arquivo está em ../scripts/.
  // Empacotado com asar + asarUnpack, ele fica em resources/app.asar.unpacked/scripts/.
  const candidatos = [
    path.join(__dirname, "..", "scripts", "gip-presencas.mjs"),
    path.join(process.resourcesPath || "", "app.asar.unpacked", "scripts", "gip-presencas.mjs"),
  ];
  for (const c of candidatos) {
    try { if (fs.existsSync(c)) return c; } catch {}
  }
  // fallback: o primeiro candidato (deixa o erro estourar com info útil)
  return candidatos[0];
}

async function iniciarAutomacao(input) {
  if (runAtual) throw new Error("Já existe uma execução em andamento.");

  appendAppLog(app, "info", "[automation] Início solicitado pela UI.", {
    turmas: Array.isArray(input.turmas) ? input.turmas.length : 0,
    manualGoogle: !!input.manualGoogle,
  });

  const exportsDir = path.join(userDataDir(), "exports");
  fs.mkdirSync(exportsDir, { recursive: true });
  const isoSafe = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const excelPath = path.join(exportsDir, `sem-presenca-todas-turmas-${isoSafe}.xlsx`);

  // Importação dinâmica do script ESM (em prod ele é desempacotado via asarUnpack).
  const automationPath = resolverAutomationPath();
  // pathToFileURL trata espaços e Windows paths corretamente.
  const { pathToFileURL } = require("node:url");
  const automationUrl    = pathToFileURL(automationPath).href;
  const { runAutomation } = await import(automationUrl);

  const controller = new AbortController();
  const senha      = lerSenha();

  const relayLog = (evt) => {
    enviar("automation:log", evt);
    appendAppLog(
      app,
      evt.level === "error" ? "error" : evt.level === "warn" ? "warn" : "info",
      evt.message ?? "",
      { tipo: "automation", ts: evt.timestamp }
    );
  };

  const promise = runAutomation({
    turmas: input.turmas,
    email:  input.email,
    password: senha ?? undefined,
    manualGoogle: input.manualGoogle ?? false,
    headless: false,
    browser: "chrome",
    excelPath,
    onLog:   relayLog,
    onEvent: (evt) => enviar("automation:event", evt),
    signal:  controller.signal,
  })
    .then((resultado) => {
      if (resultado.excelPath) {
        salvarSettings({ ultimaPlanilha: resultado.excelPath });
      }
      appendAppLog(app, "info", "[automation] Concluída com sucesso.", {
        excelPath: resultado.excelPath ?? null,
        turmas: resultado.resultados?.length,
      });
      enviar("automation:done", { ok: true, resultado });
      return resultado;
    })
    .catch((err) => {
      appendAppLog(app, "error", `[automation] Falha na execução: ${err?.message ?? String(err)}`, {
        stack: err?.stack ?? null,
      });
      enviar("automation:done", { ok: false, error: err?.message ?? String(err) });
      throw err;
    })
    .finally(() => { runAtual = null; });

  runAtual = { controller, promise };
  return { ok: true };
}

function cancelarAutomacao() {
  if (!runAtual) return { ok: false, reason: "Nenhuma execução em andamento." };
  runAtual.controller.abort();
  return { ok: true };
}

// ── IPC ───────────────────────────────────────────────────────────────────────
function registrarIPC() {
  ipcMain.handle("settings:get", () => {
    const s = lerSettings();
    return { ...s, temSenha: senhaDisponivel() };
  });

  ipcMain.handle("settings:save", (_e, parcial) => salvarSettings(parcial));

  ipcMain.handle("password:save", (_e, plain) => {
    salvarSenha(plain);
    return { ok: true, temSenha: senhaDisponivel() };
  });

  ipcMain.handle("password:clear", () => {
    salvarSenha(null);
    return { ok: true, temSenha: false };
  });

  ipcMain.handle("password:has", () => ({ temSenha: senhaDisponivel() }));

  ipcMain.handle("automation:start",  (_e, input) => iniciarAutomacao(input));
  ipcMain.handle("automation:cancel", ()        => cancelarAutomacao());
  ipcMain.handle("automation:status", ()        => ({ rodando: !!runAtual }));

  ipcMain.handle("spreadsheet:open", async (_e, caminho) => {
    const alvo = caminho || lerSettings().ultimaPlanilha;
    if (!alvo) return { ok: false, reason: "Nenhuma planilha disponível." };
    if (!fs.existsSync(alvo)) return { ok: false, reason: "Arquivo não encontrado." };
    const err = await shell.openPath(alvo);
    return err ? { ok: false, reason: err } : { ok: true };
  });

  ipcMain.handle("spreadsheet:reveal", (_e, caminho) => {
    const alvo = caminho || lerSettings().ultimaPlanilha;
    if (!alvo || !fs.existsSync(alvo)) return { ok: false };
    shell.showItemInFolder(alvo);
    return { ok: true };
  });

  ipcMain.handle("spreadsheet:pick", async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: "Selecionar planilha",
      properties: ["openFile"],
      filters: [{ name: "Excel", extensions: ["xlsx", "xls"] }],
    });
    if (r.canceled || r.filePaths.length === 0) return { ok: false };
    salvarSettings({ ultimaPlanilha: r.filePaths[0] });
    return { ok: true, path: r.filePaths[0] };
  });

  ipcMain.handle("logs:openFolder", async () => {
    const dir = path.join(userDataDir(), "logs");
    fs.mkdirSync(dir, { recursive: true });
    const err = await shell.openPath(dir);
    if (err) return { ok: false, reason: err };
    return { ok: true, path: dir };
  });

  ipcMain.handle("app:info", () => ({
    versao: versaoDoManifesto(),
    plataforma: process.platform,
    safeStorage: safeStorage.isEncryptionAvailable(),
    dadosUsuario: userDataDir(),
    pastaExports: path.join(userDataDir(), "exports"),
    pastaLogs: path.join(userDataDir(), "logs"),
  }));

  // ── updates ──────────────────────────────────────────────────────────────
  ipcMain.handle("updates:check", () => checarUltimaRelease());

  ipcMain.handle("updates:openReleases", (_e, url) => {
    const alvo = url || GITHUB_RELEASES_URL;
    shell.openExternal(alvo).catch(() => {});
    return { ok: true };
  });
}

// ── lifecycle ─────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  appendAppLog(app, "info", `[app] Sessão iniciada v${versaoDoManifesto()}`, {
    platform: process.platform,
    empacotado: app.isPackaged,
  });
  // No macOS, em dev (app não empacotado), o dock ainda mostra o ícone padrão
  // do Electron — forçamos o ícone correto via app.dock.setIcon.
  if (process.platform === "darwin" && !app.isPackaged && app.dock) {
    const iconDev = resolverIconePath();
    if (iconDev) {
      try { app.dock.setIcon(iconDev); } catch {}
    }
  }

  registrarIPC();
  criarJanela();

  // Auto-check silencioso de atualização ~3s após abrir, dando tempo da UI
  // carregar e da máquina conectar à rede. Falhas são suprimidas.
  setTimeout(async () => {
    const r = await checarUltimaRelease().catch(() => ({ ok: false }));
    if (r?.ok && r.hasUpdate) enviar("updates:available", r);
  }, 3000);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) criarJanela();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
