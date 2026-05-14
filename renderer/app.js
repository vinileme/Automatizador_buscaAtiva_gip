/* eslint-disable no-undef */
/**
 * Renderer process — UI do Automatizador GIP.
 * Comunica com o main process via window.api (preload).
 */

// ── refs DOM ─────────────────────────────────────────────────────────────────
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const els = {
  // navegação
  navItems: $$(".nav-item"),
  tabs: $$(".tab"),

  // executar
  metaEmail:  $("#meta-email"),
  metaTurmas: $("#meta-turmas"),
  metaSenha:  $("#meta-senha"),
  statusBadge: $("#status-badge"),

  btnRun:    $("#btn-run"),
  btnCancel: $("#btn-cancel"),
  btnOpen:   $("#btn-open"),
  btnReveal: $("#btn-reveal"),

  progress:      $("#progress"),
  progressFill:  $("#progress-fill"),
  progressLabel: $("#progress-label"),

  planilhaNome: $("#planilha-nome"),
  planilhaPath: $("#planilha-path"),

  log:         $("#log"),
  btnClearLog: $("#btn-clear-log"),

  // turmas
  formTurma:      $("#form-turma"),
  turmaCodigo:    $("#turma-codigo"),
  turmaEmpresa:   $("#turma-empresa"),
  turmasList:     $("#turmas-list"),
  turmasEmpty:    $("#turmas-empty"),
  turmasCount:    $("#turmas-count"),
  btnClearTurmas: $("#btn-clear-turmas"),

  // conta
  formConta:      $("#form-conta"),
  email:          $("#email"),
  senha:          $("#senha"),
  senhaHint:      $("#senha-hint"),
  btnToggleSenha: $("#btn-toggle-senha"),
  manualGoogle:   $("#manual-google"),
  btnClearSenha:  $("#btn-clear-senha"),

  // global
  toast:       $("#toast"),
  versionPill: $("#version-pill"),
  versionDot:  $("#version-dot"),
  versionText: $("#version-text"),
};

// ── estado ───────────────────────────────────────────────────────────────────
const state = {
  settings: null, // { email, turmas, ultimaPlanilha, manualGoogle, temSenha }
  rodando: false,
  totalTurmas: 0,
  feitas: 0,
  update: null,   // { hasUpdate, ultima, htmlUrl, atual } — null se ainda não checou
};

// ── helpers ──────────────────────────────────────────────────────────────────
function toast(msg, variante = "default") {
  els.toast.textContent = msg;
  els.toast.className = "toast";
  if (variante === "error") els.toast.classList.add("is-error");
  if (variante === "ok")    els.toast.classList.add("is-ok");
  els.toast.hidden = false;
  // forçar reflow para reanimar
  void els.toast.offsetWidth;
  els.toast.classList.add("is-visible");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    els.toast.classList.remove("is-visible");
    setTimeout(() => { els.toast.hidden = true; }, 220);
  }, 2600);
}

function basename(p) {
  if (!p) return "";
  const parts = p.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || p;
}

// ── inicialização ────────────────────────────────────────────────────────────
async function init() {
  state.settings = await window.api.getSettings();
  const info = await window.api.appInfo();
  els.versionText.textContent = `v${info.versao}`;

  preencherContaUI();
  renderizarTurmas();
  atualizarMeta();
  atualizarPlanilhaUI();
  registrarListeners();
}

function preencherContaUI() {
  els.email.value = state.settings.email || "";
  els.manualGoogle.checked = !!state.settings.manualGoogle;
  if (state.settings.temSenha) {
    els.senha.placeholder = "••••••••  (salva)";
    els.senhaHint.textContent = "Senha já está salva. Digite para substituir.";
  } else {
    els.senha.placeholder = "••••••••";
    els.senhaHint.textContent = "A senha é criptografada localmente (DPAPI / Keychain).";
  }
}

// ── navegação ────────────────────────────────────────────────────────────────
function ativarTab(nome) {
  els.navItems.forEach((b) => b.classList.toggle("is-active", b.dataset.tab === nome));
  els.tabs.forEach((t) => { t.hidden = t.dataset.tab !== nome; });
}

// ── turmas ───────────────────────────────────────────────────────────────────
function renderizarTurmas() {
  const turmas = state.settings.turmas || [];
  els.turmasCount.textContent = String(turmas.length);
  els.turmasEmpty.hidden = turmas.length > 0;
  els.turmasList.innerHTML = "";

  for (const t of turmas) {
    const chip = document.createElement("div");
    chip.className = "turma-chip";
    chip.innerHTML = `
      <div class="turma-info">
        <span class="turma-code">CO-${t.codigo}</span>
        <span class="turma-empresa">${t.empresa}</span>
      </div>
      <button class="turma-remove" type="button" title="Remover" aria-label="Remover">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    `;
    chip.querySelector(".turma-remove").addEventListener("click", () => removerTurma(t.codigo));
    els.turmasList.appendChild(chip);
  }

  atualizarMeta();
}

async function adicionarTurma(codigo, empresa) {
  codigo  = String(codigo).trim();
  empresa = String(empresa).trim();
  if (!codigo || !empresa) return;

  const turmas = [...(state.settings.turmas || [])];
  if (turmas.some((t) => t.codigo === codigo)) {
    toast(`Turma ${codigo} já existe.`, "error");
    return;
  }
  turmas.push({ codigo, empresa });
  state.settings = await window.api.saveSettings({ turmas });
  renderizarTurmas();
  toast(`Turma ${codigo} adicionada.`, "ok");
}

async function removerTurma(codigo) {
  const turmas = (state.settings.turmas || []).filter((t) => t.codigo !== codigo);
  state.settings = await window.api.saveSettings({ turmas });
  renderizarTurmas();
}

async function limparTurmas() {
  state.settings = await window.api.saveSettings({ turmas: [] });
  renderizarTurmas();
}

// ── conta ────────────────────────────────────────────────────────────────────
async function salvarConta(evt) {
  evt.preventDefault();
  const email        = els.email.value.trim();
  const senha        = els.senha.value;
  const manualGoogle = els.manualGoogle.checked;

  state.settings = await window.api.saveSettings({ email, manualGoogle });

  if (senha) {
    const r = await window.api.savePassword(senha);
    state.settings.temSenha = r.temSenha;
    els.senha.value = "";
  }

  preencherContaUI();
  atualizarMeta();
  toast("Configuração salva.", "ok");
}

async function removerSenha() {
  const r = await window.api.clearPassword();
  state.settings.temSenha = r.temSenha;
  preencherContaUI();
  atualizarMeta();
  toast("Senha removida.", "ok");
}

// ── meta info ────────────────────────────────────────────────────────────────
function atualizarMeta() {
  els.metaEmail.textContent  = state.settings.email || "—";
  els.metaTurmas.textContent = String((state.settings.turmas || []).length);
  els.metaSenha.textContent  = state.settings.temSenha ? "Sim" : "Não";
}

function atualizarPlanilhaUI() {
  const p = state.settings.ultimaPlanilha;
  if (p) {
    els.planilhaNome.textContent = basename(p);
    els.planilhaPath.textContent = p;
    els.btnOpen.disabled   = false;
    els.btnReveal.disabled = false;
  } else {
    els.planilhaNome.textContent = "Nenhuma gerada ainda";
    els.planilhaPath.textContent = "—";
    els.btnOpen.disabled   = true;
    els.btnReveal.disabled = true;
  }
}

// ── status ───────────────────────────────────────────────────────────────────
function setStatus(texto, classe) {
  els.statusBadge.textContent = texto;
  els.statusBadge.className = "badge";
  if (classe) els.statusBadge.classList.add(classe);
}

function setProgresso(feitas, total, label) {
  els.progress.hidden = total === 0;
  const pct = total > 0 ? Math.round((feitas / total) * 100) : 0;
  els.progressFill.style.width = `${pct}%`;
  els.progressLabel.textContent = label || `${feitas}/${total} turma(s) processada(s) — ${pct}%`;
}

// ── execução ─────────────────────────────────────────────────────────────────
async function iniciarAutomacao() {
  if (state.rodando) return;
  const settings = state.settings;
  if (!settings.email) {
    toast("Informe um e-mail na aba Conta.", "error");
    ativarTab("conta");
    return;
  }
  const turmas = settings.turmas || [];
  if (turmas.length === 0) {
    toast("Adicione pelo menos uma turma.", "error");
    ativarTab("turmas");
    return;
  }

  limparLog();
  state.rodando = true;
  state.totalTurmas = turmas.length;
  state.feitas = 0;

  els.btnRun.disabled    = true;
  els.btnCancel.disabled = false;
  setStatus("Executando…", "is-running");
  setProgresso(0, turmas.length, `0/${turmas.length} turmas — iniciando…`);

  try {
    await window.api.startAutomation({
      email: settings.email,
      manualGoogle: !!settings.manualGoogle,
      turmas,
    });
  } catch (err) {
    finalizar({ ok: false, error: err?.message ?? String(err) });
  }
}

async function cancelarAutomacao() {
  await window.api.cancelAutomation();
  appendLog({ level: "warn", message: "Cancelamento solicitado…", timestamp: new Date().toISOString() });
}

function finalizar(payload) {
  state.rodando = false;
  els.btnRun.disabled    = false;
  els.btnCancel.disabled = true;

  if (payload.ok) {
    setStatus("Concluído", "is-ok");
    setProgresso(state.totalTurmas, state.totalTurmas, "Concluído");
    if (payload.resultado?.excelPath) {
      state.settings.ultimaPlanilha = payload.resultado.excelPath;
      atualizarPlanilhaUI();
      toast("Planilha gerada com sucesso.", "ok");
    } else {
      toast("Execução concluída — nenhuma planilha gerada.", "ok");
    }
  } else {
    setStatus("Erro", "is-error");
    toast(payload.error || "Erro na execução.", "error");
  }
}

// ── log ──────────────────────────────────────────────────────────────────────
function limparLog() {
  els.log.innerHTML = "";
}

function appendLog(evt) {
  const linha = document.createElement("span");
  linha.className = "log-line";
  if (evt.level === "warn")  linha.classList.add("is-warn");
  if (evt.level === "error") linha.classList.add("is-error");

  const hora = new Date(evt.timestamp || Date.now()).toLocaleTimeString("pt-BR", { hour12: false });
  const time = document.createElement("span");
  time.className = "time";
  time.textContent = hora;
  linha.appendChild(time);

  const msg = document.createElement("span");
  msg.textContent = evt.message ?? "";
  linha.appendChild(msg);

  // newline visual
  linha.appendChild(document.createTextNode("\n"));

  const noFim =
    els.log.scrollTop + els.log.clientHeight >= els.log.scrollHeight - 12;
  els.log.appendChild(linha);
  if (noFim) els.log.scrollTop = els.log.scrollHeight;
}

// ── updates ──────────────────────────────────────────────────────────────────
function aplicarEstadoUpdate(info) {
  state.update = info;
  const has = !!(info && info.hasUpdate);
  els.versionDot.hidden = !has;
  els.versionPill.classList.toggle("has-update", has);
  if (has) {
    els.versionPill.title = `Nova versão ${info.ultima} disponível — clique para baixar`;
  } else {
    els.versionPill.title = "Verificar atualizações";
  }
}

function handleUpdateAvailable(info) {
  aplicarEstadoUpdate(info);
  toast(`Nova versão ${info.ultima} disponível — clique no número da versão para baixar`, "ok");
}

async function checarUpdateManual() {
  // Se já sabemos que há update, abre direto a página da release.
  if (state.update?.hasUpdate) {
    await window.api.openReleases(state.update.htmlUrl);
    return;
  }

  els.versionPill.classList.add("is-checking");
  const original = els.versionText.textContent;
  els.versionText.textContent = "Verificando…";

  try {
    const r = await window.api.checkUpdates();
    if (!r.ok) {
      toast(r.reason || "Não foi possível verificar agora.", "error");
      return;
    }
    aplicarEstadoUpdate(r);
    if (r.hasUpdate) {
      toast(`Nova versão ${r.ultima} disponível — abrindo página de download…`, "ok");
      await window.api.openReleases(r.htmlUrl);
    } else {
      toast(`Você está na versão mais recente (${r.atual}).`, "ok");
    }
  } catch (err) {
    toast(err?.message || "Erro ao verificar atualizações.", "error");
  } finally {
    els.versionPill.classList.remove("is-checking");
    els.versionText.textContent = original;
  }
}

// ── listeners ────────────────────────────────────────────────────────────────
function registrarListeners() {
  // navegação
  els.navItems.forEach((b) => b.addEventListener("click", () => ativarTab(b.dataset.tab)));

  // execução
  els.btnRun.addEventListener("click", iniciarAutomacao);
  els.btnCancel.addEventListener("click", cancelarAutomacao);
  els.btnClearLog.addEventListener("click", limparLog);

  els.btnOpen.addEventListener("click", async () => {
    const r = await window.api.openSpreadsheet();
    if (!r.ok) toast(r.reason || "Não foi possível abrir.", "error");
  });
  els.btnReveal.addEventListener("click", async () => {
    const r = await window.api.revealSpreadsheet();
    if (!r.ok) toast("Não foi possível localizar o arquivo.", "error");
  });

  // turmas
  els.formTurma.addEventListener("submit", async (e) => {
    e.preventDefault();
    await adicionarTurma(els.turmaCodigo.value, els.turmaEmpresa.value);
    els.turmaCodigo.value  = "";
    els.turmaEmpresa.value = "";
    els.turmaCodigo.focus();
  });
  els.btnClearTurmas.addEventListener("click", async () => {
    if ((state.settings.turmas || []).length === 0) return;
    if (!confirm("Remover todas as turmas?")) return;
    await limparTurmas();
  });

  // conta
  els.formConta.addEventListener("submit", salvarConta);
  els.btnClearSenha.addEventListener("click", removerSenha);
  els.btnToggleSenha.addEventListener("click", () => {
    const visivel = els.senha.type === "text";
    els.senha.type = visivel ? "password" : "text";
  });

  // updates
  els.versionPill.addEventListener("click", checarUpdateManual);
  window.api.onUpdateAvailable(handleUpdateAvailable);

  // automation events
  window.api.onLog(appendLog);

  window.api.onEvent((evt) => {
    if (evt.tipo === "turma_inicio") {
      const { index, total, turma } = evt.payload;
      setProgresso(index, total, `Processando ${index + 1}/${total} — CO-${turma.codigo} (${turma.empresa})`);
    } else if (evt.tipo === "turma_fim") {
      state.feitas = evt.payload.index + 1;
      setProgresso(state.feitas, evt.payload.total);
    } else if (evt.tipo === "fim") {
      setProgresso(state.totalTurmas, state.totalTurmas, "Finalizando…");
    }
  });

  window.api.onDone(finalizar);
}

// ── go ───────────────────────────────────────────────────────────────────────
init().catch((err) => {
  console.error(err);
  toast(err?.message ?? "Erro de inicialização", "error");
});
