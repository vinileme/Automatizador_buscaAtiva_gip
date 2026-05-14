/**
 * Automação GIP → Presenças (Chrome).
 * Processa múltiplas turmas em sequência numa mesma sessão do navegador.
 *
 * Pode ser usado de duas formas:
 *   1) CLI: `npm run gip`  (lê config de variáveis de ambiente)
 *   2) Programaticamente: `import { runAutomation } from "./gip-presencas.mjs"`
 *
 * Ajuste localizadores com:
 *   npm run gip:codegen
 * @see https://playwright.dev/docs/codegen
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import ExcelJS from "exceljs";
import {
  escapeRegex,
  montarLinhaResumo,
  deveGerarLinhasDetalhe,
} from "./lib/gip-presencas-helpers.mjs";

// ──────────────────────────────────────────────────────────────────────────────
// Lista padrão de turmas (usada quando rodando via CLI sem config)
// ──────────────────────────────────────────────────────────────────────────────

const TURMAS_PADRAO = [
  // Eurofarma
  { codigo: "1558", empresa: "Eurofarma" },
  { codigo: "1560", empresa: "Eurofarma" },
  { codigo: "1562", empresa: "Eurofarma" },
  { codigo: "1563", empresa: "Eurofarma" },
  { codigo: "2325", empresa: "Eurofarma" },
  { codigo: "2326", empresa: "Eurofarma" },
  // TREECORP
  { codigo: "3386", empresa: "TREECORP" },
  { codigo: "3384", empresa: "TREECORP" },
  // RIO PRETO
  { codigo: "113",  empresa: "RIO PRETO" },
  { codigo: "4405", empresa: "RIO PRETO" },
  { codigo: "73",   empresa: "RIO PRETO" },
  { codigo: "2687", empresa: "RIO PRETO" },
  // SAMIRA BRANCO
  { codigo: "2707", empresa: "SAMIRA BRANCO" },
  { codigo: "2708", empresa: "SAMIRA BRANCO" },
];

// ──────────────────────────────────────────────────────────────────────────────
// Configuração base (timeouts/retries não mudam por execução)
// ──────────────────────────────────────────────────────────────────────────────

const GIP_BASE = "https://gip.eduquest.dev/";
const GIP_AUTH_URL_REGEX =
  /gip\.eduquest\.dev|auth-production-api\.alicerceedu\.com/;

const TIMEOUTS = {
  default: 90_000,
  login: 300_000,
  click: 12_000,
  field: 45_000,
  step: 35_000,
  networkIdle: 12_000,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isVisible = (locator) => locator.isVisible().catch(() => false);

// ──────────────────────────────────────────────────────────────────────────────
// Login Google (botão GSI dentro de iframe ou na própria página)
// ──────────────────────────────────────────────────────────────────────────────

const GSI_IFRAME_SELECTORS = [
  'iframe[src*="accounts.google.com"]',
  'iframe[src*="google.com/gsi"]',
  ".g_id_signin iframe",
  'iframe[title*="Fazer login com o Google" i]',
  'iframe[title*="Google" i]',
];

function botaoLoginGoogle(parent) {
  return parent
    .getByRole("button", { name: /fazer login com o google/i })
    .or(parent.getByText(/^Fazer Login com o Google$/i))
    .or(parent.locator('[role="button"][aria-labelledby="button-label"]'))
    .first();
}

async function clicarGatilhoLoginGoogle(page) {
  await page
    .locator(GSI_IFRAME_SELECTORS.join(", "))
    .first()
    .waitFor({ state: "attached", timeout: TIMEOUTS.step })
    .catch(() => {});

  for (const sel of GSI_IFRAME_SELECTORS) {
    const botao = botaoLoginGoogle(page.frameLocator(sel));
    const visivel = await botao
      .waitFor({ state: "visible", timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (!visivel) continue;
    await botao.scrollIntoViewIfNeeded().catch(() => {});
    await botao.click({ timeout: TIMEOUTS.click }).catch(async () => {
      await botao.click({ force: true });
    });
    return true;
  }

  const botaoPagina = botaoLoginGoogle(page);
  const visivel = await botaoPagina
    .waitFor({ state: "visible", timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (!visivel) return false;

  await botaoPagina.scrollIntoViewIfNeeded().catch(() => {});
  await botaoPagina.click({ timeout: TIMEOUTS.click }).catch(async () => {
    await botaoPagina.click({ force: true });
  });
  return true;
}

async function buscarPaginaGoogleAberta(context, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const p of context.pages()) {
      if (/accounts\.google\.com/.test(p.url())) {
        await p.waitForLoadState("domcontentloaded").catch(() => {});
        return p;
      }
    }
    await sleep(200);
  }
  return null;
}

async function clicarProximoGoogle(target, etapa) {
  const candidatos = [];
  if (etapa === "identifier") {
    candidatos.push(target.locator("#identifierNext button").first());
    candidatos.push(target.locator("#identifierNext").first());
  } else if (etapa === "password") {
    candidatos.push(target.locator("#passwordNext button").first());
    candidatos.push(target.locator("#passwordNext").first());
  }
  candidatos.push(
    target
      .getByRole("button", {
        name: /^(next|próximo|continue|continuar)$/i,
      })
      .first()
  );

  for (const loc of candidatos) {
    if ((await loc.count()) === 0 || !(await isVisible(loc))) continue;
    await loc.scrollIntoViewIfNeeded().catch(() => {});
    await loc.click({ timeout: TIMEOUTS.click }).catch(async () => {
      await loc.click({ force: true });
    });
    return true;
  }
  return false;
}

async function preencherCampoGoogle(page, campo, valor) {
  const selecionarTudo =
    process.platform === "darwin" ? "Meta+A" : "Control+A";
  await campo.scrollIntoViewIfNeeded().catch(() => {});
  await campo.click({ timeout: TIMEOUTS.click });
  await campo.fill("").catch(() => {});

  await campo.fill(valor).catch(() => {});
  let atual = await campo.inputValue().catch(() => "");
  if (atual === valor) return true;

  await campo.click({ timeout: TIMEOUTS.click });
  await page.keyboard.press(selecionarTudo);
  await page.keyboard.press("Backspace");
  await page.keyboard.type(valor, { delay: 80 });
  atual = await campo.inputValue().catch(() => "");
  return atual === valor;
}

async function abrirPopupGoogle(page, log) {
  const context = page.context();
  const popupPromise = context
    .waitForEvent("page", { timeout: 60_000 })
    .catch(() => null);

  if (!(await clicarGatilhoLoginGoogle(page))) {
    log.error("Não foi possível clicar no botão Google.");
    return null;
  }

  let popup = await popupPromise;
  if (!popup) popup = await buscarPaginaGoogleAberta(context, TIMEOUTS.step);
  if (!popup || popup === page) {
    log.warn("Popup do Google não detectado.");
    return null;
  }

  await popup.waitForLoadState("domcontentloaded").catch(() => {});
  await popup
    .waitForURL(/accounts\.google\.com/, { timeout: 30_000 })
    .catch(() => {});
  await popup.bringToFront().catch(() => {});
  log.info(`Popup do Google detectado: ${popup.url().slice(0, 80)}…`);
  return popup;
}

async function loginAutomaticoGoogle(page, { email, password, log }) {
  if (!email) return false;

  const popup = await abrirPopupGoogle(page, log);
  if (!popup) return false;

  const emailInput = popup
    .locator("#identifierId")
    .or(popup.locator('input[name="identifier"]'))
    .or(popup.getByLabel(/email or phone|e-mail ou telefone/i))
    .first();

  try {
    await emailInput.waitFor({ state: "visible", timeout: TIMEOUTS.step });
  } catch {
    log.error("Campo de email não apareceu no popup.");
    return false;
  }

  log.info(`Preenchendo email: ${email}`);
  const okEmail = await preencherCampoGoogle(popup, emailInput, email);
  if (!okEmail) {
    log.error("Falha ao preencher o campo de email.");
    return false;
  }

  if (!(await clicarProximoGoogle(popup, "identifier"))) {
    await emailInput.press("Enter").catch(() => {});
  }
  log.info('Cliquei em "Next" após o email.');

  if (!password) {
    log.info("Senha não definida — digite manualmente no popup.");
    return true;
  }

  const passwordInput = popup
    .locator('input[type="password"][name="Passwd"]')
    .or(popup.locator('input[type="password"]'))
    .first();

  try {
    await passwordInput.waitFor({ state: "visible", timeout: TIMEOUTS.step });
  } catch {
    log.warn("Campo de senha não apareceu (verificação extra do Google?).");
    return true;
  }

  log.info("Preenchendo senha…");
  const okPass = await preencherCampoGoogle(popup, passwordInput, password);
  if (!okPass) log.warn("Falha ao preencher senha — finalize manualmente.");

  if (!(await clicarProximoGoogle(popup, "password"))) {
    await passwordInput.press("Enter").catch(() => {});
  }
  log.info('Cliquei em "Next" após a senha.');
  return true;
}

async function realizarLogin(page, { email, password, manualGoogle, log }) {
  if (manualGoogle) {
    if (await clicarGatilhoLoginGoogle(page)) {
      log.info("Login manual: digite seus dados na janela do Google.");
    } else {
      log.warn("Gatilho de login não encontrado. Conclua manualmente.");
    }
    return;
  }

  if (email) {
    const auto = await loginAutomaticoGoogle(page, { email, password, log });
    if (auto) {
      log.info(
        "Login automático enviado. Se houver 2FA/confirmação, conclua manualmente."
      );
      return;
    }
    log.warn("Login automático falhou — finalize manualmente na janela aberta.");
    return;
  }

  if (await clicarGatilhoLoginGoogle(page)) {
    log.info("Fluxo Google aberto. Conclua manualmente (e-mail/senha/2FA).");
  } else {
    log.warn("Gatilho de login Google não encontrado.");
  }
}

async function aguardarPosLogin(context, timeoutMs = TIMEOUTS.login) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const p of context.pages()) {
      const minhasTurmas = p.getByText(/Minhas turmas/i).first();
      if (await isVisible(minhasTurmas)) {
        await p.bringToFront().catch(() => {});
        return p;
      }
    }
    await sleep(400);
  }
  throw new Error(
    'Timeout: "Minhas turmas" não apareceu. Conclua o login.'
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Busca da turma (com retry + reload)
// ──────────────────────────────────────────────────────────────────────────────

async function resolverCampoBuscarTurma(page) {
  const deadline = Date.now() + TIMEOUTS.field;
  const candidatos = [
    () => page.getByPlaceholder(/Buscar turma/i).first(),
    () => page.getByLabel(/Buscar turma/i).first(),
    () => page.getByRole("searchbox", { name: /Buscar turma/i }).first(),
  ];
  while (Date.now() < deadline) {
    for (const fn of candidatos) {
      const loc = fn();
      if (await isVisible(loc)) return loc;
    }
    await sleep(200);
  }
  throw new Error('Campo "Buscar turma" não ficou visível a tempo.');
}

async function digitarCodigoTurma(page, campo, codigo) {
  const selecionarTudo =
    process.platform === "darwin" ? "Meta+A" : "Control+A";
  await campo.scrollIntoViewIfNeeded().catch(() => {});
  await campo.click({ timeout: TIMEOUTS.click });
  await page.keyboard.press(selecionarTudo);
  await page.keyboard.press("Backspace");
  await page.keyboard.type(codigo, { delay: 100 });
  await page.keyboard.press("Enter");
}

const GIP_DIRETORIO_PATH = "/diretorio/turmas";
const TURMA_ROW_PATTERN = /^CO-\d+/;

function localizadorDaTurma(page, pattern) {
  return page
    .getByRole("link", { name: pattern })
    .or(page.getByRole("button", { name: pattern }))
    .or(page.getByRole("row", { name: pattern }))
    .or(page.getByText(pattern))
    .first();
}

async function aguardarListaDeTurmas(page, timeoutMs = 30_000) {
  await page
    .waitForLoadState("networkidle", { timeout: TIMEOUTS.networkIdle })
    .catch(() => {});
  await page
    .getByText(TURMA_ROW_PATTERN)
    .first()
    .waitFor({ state: "visible", timeout: timeoutMs })
    .catch(() => {});
}

async function navegarParaDiretorio(page) {
  if (!page.url().includes(GIP_DIRETORIO_PATH)) {
    const minhasTurmas = page.getByText(/Minhas turmas/i).first();
    if (await isVisible(minhasTurmas)) {
      await minhasTurmas.click().catch(() => {});
      await page.waitForLoadState("domcontentloaded").catch(() => {});
    }

    const diretorio = page.getByText(/Diretório de turmas/i).first();
    if (await isVisible(diretorio)) {
      await diretorio.click().catch(() => {});
      await page.waitForLoadState("domcontentloaded").catch(() => {});
    } else if (!page.url().includes(GIP_DIRETORIO_PATH)) {
      const direta = new URL(GIP_DIRETORIO_PATH, page.url()).href;
      await page.goto(direta, { waitUntil: "domcontentloaded" });
    }
  }

  await aguardarListaDeTurmas(page);
}

async function tentarBuscaTurma(page, turma, retryEsperaMs) {
  await navegarParaDiretorio(page);

  const campo = await resolverCampoBuscarTurma(page);
  await sleep(retryEsperaMs);
  await digitarCodigoTurma(page, campo, turma.codigo);

  const pattern = new RegExp(`CO-${turma.codigo}`, "i");
  const loc = localizadorDaTurma(page, pattern);
  return loc
    .waitFor({ state: "visible", timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
}

/**
 * Busca uma turma no diretório. Retorna `true` quando a linha do CO-código ficou visível.
 * Na última falha apenas retorna `false` (fluxo deve seguir para a próxima turma).
 */
async function encontrarTurmaComRetry(page, turma, { maxTentativas, retryEsperaMs, log }) {
  for (let n = 1; n <= maxTentativas; n++) {
    log.info(
      `[${turma.empresa}] Buscando turma "${turma.codigo}" (tentativa ${n}/${maxTentativas})…`
    );
    if (await tentarBuscaTurma(page, turma, retryEsperaMs)) {
      log.info(`[${turma.empresa}] Turma ${turma.codigo} encontrada.`);
      return true;
    }
    if (n === maxTentativas) break;
    log.warn("Sem resultado. Atualizando a página e tentando novamente…");
    await page.reload({ waitUntil: "domcontentloaded" });
  }
  return false;
}

// ──────────────────────────────────────────────────────────────────────────────
// Fluxo pós-turma (Presenças → Horário da Aula → Aluno)
// ──────────────────────────────────────────────────────────────────────────────

async function abrirTurmaSelecionada(page, turma) {
  const pattern = new RegExp(`CO-${turma.codigo}`, "i");
  await localizadorDaTurma(page, pattern).click();
  await page.waitForLoadState("domcontentloaded");
}

async function abrirPresencas(page) {
  await page
    .getByRole("link", { name: /^\s*Presenças\s*$/i })
    .or(page.getByRole("button", { name: /Presenças/i }))
    .or(page.getByText(/^Presenças$/i))
    .first()
    .click();
  await page.waitForLoadState("domcontentloaded");
}

async function clicarHorarioDaAula(page, log) {
  const candidatos = [
    page.locator("div.text", { hasText: /^Horário da Aula$/i }).first(),
    page.locator(".text").filter({ hasText: /^Horário da Aula$/i }).first(),
    page.getByText(/^Horário da Aula$/i).first(),
    page.getByRole("button", { name: /horário da aula/i }).first(),
  ];

  for (const loc of candidatos) {
    try {
      await loc.waitFor({ state: "visible", timeout: 8_000 });
    } catch {
      continue;
    }
    await loc.scrollIntoViewIfNeeded().catch(() => {});
    try {
      await loc.click({ timeout: TIMEOUTS.click });
    } catch {
      await loc.click({ force: true });
    }
    log.info('Cliquei em "Horário da Aula".');
    return true;
  }
  throw new Error('Botão "Horário da Aula" não encontrado.');
}

async function clicarAluno(page, log) {
  const candidatos = [
    page.getByRole("button", { name: /^Aluno\s*\(\d+\)/i }).first(),
    page
      .locator('button[id^="radix-"]')
      .filter({ hasText: /^Aluno\s*\(\d+\)/i })
      .first(),
    page.locator("button").filter({ hasText: /^Aluno\s*\(\d+\)/i }).first(),
    page.getByText(/^Aluno\s*\(\d+\)/i).first(),
    page.getByRole("button", { name: /^Aluno\b/i }).first(),
  ];

  for (const loc of candidatos) {
    try {
      await loc.waitFor({ state: "visible", timeout: 8_000 });
    } catch {
      continue;
    }
    await loc.scrollIntoViewIfNeeded().catch(() => {});
    try {
      await loc.click({ timeout: TIMEOUTS.click });
    } catch {
      await loc.click({ force: true });
    }
    log.info('Cliquei em "Aluno".');
    return true;
  }
  throw new Error('Botão "Aluno" não encontrado.');
}

async function selecionarHorarioEAluno(page, log) {
  await clicarHorarioDaAula(page, log);
  log.info('Aguardando 5s antes de clicar em "Aluno"…');
  await sleep(5_000);
  await clicarAluno(page, log);
}

// ──────────────────────────────────────────────────────────────────────────────
// Coleta de alunos sem presença
// ──────────────────────────────────────────────────────────────────────────────

async function coletarAlunosSemPresenca(page, turma, log) {
  log.info(`[${turma.empresa}] Aguardando lista de alunos da turma ${turma.codigo}…`);

  await page
    .locator("a.card-container")
    .first()
    .waitFor({ state: "visible", timeout: 30_000 })
    .catch(() => {});

  await sleep(2_000);

  const semPresenca = page.locator('a.card-container[data-selected="false"]');
  const total = await semPresenca.count();

  if (total === 0) {
    log.info(`[${turma.empresa}] Turma ${turma.codigo}: todos os alunos têm presença.`);
    return [];
  }

  const nomes = [];
  for (let i = 0; i < total; i++) {
    const card = semPresenca.nth(i);
    const nome = await card
      .locator(".c-byPlEw")
      .first()
      .textContent()
      .catch(() => "");
    if (nome?.trim()) nomes.push(nome.trim());
  }

  log.info(`[${turma.empresa}] Turma ${turma.codigo} — Alunos SEM presença (${nomes.length}):`);
  for (const nome of nomes) {
    log.info(`  ✗ ${nome}`);
  }

  return nomes;
}

// ──────────────────────────────────────────────────────────────────────────────
// Coleta de telefones (aba Informações da turma)
// ──────────────────────────────────────────────────────────────────────────────

async function abrirAbaInformacoes(page, turma, log) {
  const url = new URL(`/diretorio/turmas/${turma.codigo}`, GIP_BASE).href;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page
    .waitForLoadState("networkidle", { timeout: TIMEOUTS.networkIdle })
    .catch(() => {});

  const candidatos = [
    page.locator('button[id*="trigger-tab-class-informacoes"]').first(),
    page.getByRole("tab", { name: /^Informações$/i }).first(),
    page.locator('button[role="tab"]').filter({ hasText: /^Informações$/i }).first(),
    page.locator(".tabs-list-item-button").filter({ hasText: /^Informações$/i }).first(),
  ];

  for (const loc of candidatos) {
    try {
      await loc.waitFor({ state: "visible", timeout: 8_000 });
    } catch {
      continue;
    }
    await loc.scrollIntoViewIfNeeded().catch(() => {});
    try {
      await loc.click({ timeout: TIMEOUTS.click });
    } catch {
      await loc.click({ force: true });
    }
    log.info('Cliquei na aba "Informações".');
    await sleep(1_500);
    return true;
  }
  throw new Error('Aba "Informações" não encontrada.');
}

async function lerTelefoneVisivel(page) {
  const wrapper = page.locator('[name="responsible.phone"]').first();
  try {
    await wrapper.waitFor({ state: "visible", timeout: 10_000 });
  } catch {
    return "";
  }
  const txt = await wrapper
    .locator(".container-text-ellipsis, .input-read-only-container")
    .first()
    .textContent()
    .catch(() => "");
  return (txt ?? "").trim();
}

async function fecharDetalheAluno(page, turma, log) {
  await page.keyboard.press("Escape").catch(() => {});
  await sleep(300);

  const fechar = page
    .getByRole("button", { name: /fechar|voltar|close/i })
    .first();
  if (await isVisible(fechar)) {
    await fechar.click({ timeout: TIMEOUTS.click }).catch(() => {});
    await sleep(300);
  }

  const urlEsperada = `/diretorio/turmas/${turma.codigo}`;
  if (!page.url().includes(urlEsperada)) {
    await abrirAbaInformacoes(page, turma, log);
  }
}

async function coletarTelefonesDosAusentes(page, turma, nomes, log) {
  log.info(
    `[${turma.empresa}] Coletando telefones de ${nomes.length} aluno(s) ausente(s)…`
  );
  await abrirAbaInformacoes(page, turma, log);

  await page
    .locator(".card-header")
    .first()
    .waitFor({ state: "visible", timeout: 30_000 })
    .catch(() => {});
  await sleep(1_000);

  const alunos = [];

  for (const nome of nomes) {
    log.info(`  → Buscando "${nome}"…`);
    const nomeRegex = new RegExp(`^\\s*${escapeRegex(nome)}\\s*$`, "i");

    const card = page
      .locator(".card-header")
      .filter({ has: page.locator(".c-byPlEw", { hasText: nomeRegex }) })
      .first()
      .or(
        page.locator(".c-byPlEw").filter({ hasText: nomeRegex }).first()
      )
      .first();

    let telefone = "";
    try {
      await card.waitFor({ state: "visible", timeout: 8_000 });
      await card.scrollIntoViewIfNeeded().catch(() => {});
      try {
        await card.click({ timeout: TIMEOUTS.click });
      } catch {
        await card.click({ force: true });
      }
      telefone = await lerTelefoneVisivel(page);
      log.info(`    ☎  ${telefone || "(vazio)"}`);
    } catch (err) {
      log.warn(`    ✗ Não foi possível obter telefone: ${err.message}`);
    }

    alunos.push({ nome, telefone });

    await fecharDetalheAluno(page, turma, log).catch(() => {});
  }

  return alunos;
}

// ──────────────────────────────────────────────────────────────────────────────
// Exportação Excel — arquivo único com aba por empresa
// ──────────────────────────────────────────────────────────────────────────────

const EMPRESA_COLORS = {
  "Eurofarma":     { header: "FF1F497D", alt: "FFD9E1F2" },
  "TREECORP":      { header: "FF375623", alt: "FFD8E4BC" },
  "RIO PRETO":     { header: "FF7B2C2C", alt: "FFFCE4D6" },
  "SAMIRA BRANCO": { header: "FF4B3070", alt: "FFEDE7F6" },
};

const DEFAULT_COLOR = { header: "FF404040", alt: "FFF2F2F2" };

async function salvarExcelCombinado(resultados, { excelPath, log }) {
  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .slice(0, 19);
  const outputPath = excelPath
    ? path.resolve(excelPath)
    : path.resolve(`sem-presenca-todas-turmas-${timestamp}.xlsx`);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "automatizador-gip";
  workbook.created = new Date();

  // Aba "Resumo" com totais
  const resumoSheet = workbook.addWorksheet("Resumo");
  resumoSheet.columns = [
    { header: "Empresa",         key: "empresa",  width: 20 },
    { header: "Turma",           key: "turma",    width: 12 },
    { header: "Sem Presença",    key: "total",    width: 16 },
    { header: "Status",          key: "status",   width: 22 },
    { header: "Data/Hora",       key: "dataHora", width: 22 },
  ];
  const resumoHeader = resumoSheet.getRow(1);
  resumoHeader.font = { bold: true, color: { argb: "FFFFFFFF" } };
  resumoHeader.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF404040" } };
  resumoHeader.alignment = { vertical: "middle", horizontal: "center" };
  resumoHeader.height = 20;

  const dataHora = new Date().toLocaleString("pt-BR");

  for (const resultado of resultados) {
    resumoSheet.addRow(montarLinhaResumo(resultado, dataHora));
  }
  resumoSheet.autoFilter = { from: "A1", to: "E1" };

  // Uma aba por empresa com os alunos ausentes + telefones
  const empresasVistas = new Set();
  for (const resultado of resultados) {
    if (!deveGerarLinhasDetalhe(resultado)) continue;
    const { turma, alunos } = resultado;

    const cores = EMPRESA_COLORS[turma.empresa] ?? DEFAULT_COLOR;
    const nomesAba = turma.empresa.slice(0, 31);

    let sheet;
    if (empresasVistas.has(turma.empresa)) {
      sheet = workbook.getWorksheet(nomesAba);
    } else {
      sheet = workbook.addWorksheet(nomesAba);
      sheet.columns = [
        { header: "Nº",            key: "numero",   width: 6  },
        { header: "Nome do Aluno", key: "nome",     width: 45 },
        { header: "Telefone",      key: "telefone", width: 22 },
        { header: "Turma",         key: "turma",    width: 12 },
        { header: "Data/Hora",     key: "dataHora", width: 22 },
      ];
      const headerRow = sheet.getRow(1);
      headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
      headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: cores.header } };
      headerRow.alignment = { vertical: "middle", horizontal: "center" };
      headerRow.height = 20;
      sheet.autoFilter = { from: "A1", to: "E1" };
      empresasVistas.add(turma.empresa);
    }

    const startRow = sheet.rowCount + 1;
    alunos.forEach(({ nome, telefone }, idx) => {
      const globalIdx = startRow + idx - 2;
      const row = sheet.addRow({
        numero: globalIdx + 1,
        nome,
        telefone: telefone || "",
        turma: turma.codigo,
        dataHora,
      });
      if (globalIdx % 2 === 1) {
        row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: cores.alt } };
      }
      row.alignment = { vertical: "middle" };
    });
  }

  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
  await workbook.xlsx.writeFile(outputPath);
  log.info(`Planilha combinada salva em: ${outputPath}`);
  return outputPath;
}

// ──────────────────────────────────────────────────────────────────────────────
// Processamento de uma única turma
// ──────────────────────────────────────────────────────────────────────────────

async function verificarNenhumaAula(page) {
  await sleep(1_500);
  const porCSS = page.locator("p b", { hasText: /^Nenuma aula encontrada$/i }).first();
  const porTexto = page.getByText(/^Nenu?ma aula encontrada$/i).first();
  const visivel =
    (await porCSS.isVisible().catch(() => false)) ||
    (await porTexto.isVisible().catch(() => false));
  return visivel;
}

async function processarTurma(page, turma, opts) {
  const { log } = opts;
  try {
    const encontrada = await encontrarTurmaComRetry(page, turma, opts);
    if (!encontrada) {
      log.warn(
        `[${turma.empresa}] Turma ${turma.codigo} não encontrada após ${opts.maxTentativas} tentativa(s). Sem lista de chamadas — próxima turma.`
      );
      return { turma, alunos: [], erro: null, semAula: false, semListaChamadas: true };
    }

    await abrirTurmaSelecionada(page, turma);
    await abrirPresencas(page);

    if (await verificarNenhumaAula(page)) {
      log.warn(`[${turma.empresa}] Turma ${turma.codigo}: nenhuma aula encontrada — pulando.`);
      return { turma, alunos: [], erro: null, semAula: true, semListaChamadas: false };
    }

    await selecionarHorarioEAluno(page, log);

    if (await verificarNenhumaAula(page)) {
      log.warn(`[${turma.empresa}] Turma ${turma.codigo}: nenhuma aula encontrada após selecionar horário — pulando.`);
      return { turma, alunos: [], erro: null, semAula: true, semListaChamadas: false };
    }

    const nomes = await coletarAlunosSemPresenca(page, turma, log);

    if (nomes.length === 0) {
      return { turma, alunos: [], erro: null, semAula: false, semListaChamadas: false };
    }

    let alunos;
    try {
      alunos = await coletarTelefonesDosAusentes(page, turma, nomes, log);
    } catch (err) {
      log.warn(`[${turma.empresa}] Falha ao coletar telefones: ${err.message}`);
      alunos = nomes.map((nome) => ({ nome, telefone: "" }));
    }

    return { turma, alunos, erro: null, semAula: false, semListaChamadas: false };
  } catch (err) {
    log.error(`[${turma.empresa}] Erro na turma ${turma.codigo}: ${err.message}`);
    return { turma, alunos: [], erro: err.message, semAula: false, semListaChamadas: false };
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// API principal — pode ser usada pelo Electron (ou outro consumidor)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Cria um objeto de log que repassa para um callback (e opcionalmente console).
 */
function criarLogger(onLog, espelharNoConsole = false) {
  const emitir = (level, msg) => {
    if (espelharNoConsole) {
      if (level === "error")      console.error(`[GIP] ${msg}`);
      else if (level === "warn")  console.warn(`[GIP] ${msg}`);
      else                        console.log(`[GIP] ${msg}`);
    }
    try {
      onLog?.({ level, message: msg, timestamp: new Date().toISOString() });
    } catch {
      // ignora erros do listener
    }
  };
  return {
    info:  (m) => emitir("info",  m),
    warn:  (m) => emitir("warn",  m),
    error: (m) => emitir("error", m),
  };
}

/**
 * Executa o fluxo completo de automação.
 *
 * @param {object}   options
 * @param {Array<{codigo:string, empresa:string}>} options.turmas
 * @param {string}   options.email            E-mail Google.
 * @param {string}   [options.password]       Senha (opcional — sem ela o usuário digita à mão).
 * @param {boolean}  [options.manualGoogle]   Se true, só clica no botão e o usuário faz tudo.
 * @param {string}   [options.excelPath]      Caminho de saída do .xlsx (opcional).
 * @param {boolean}  [options.headless=false] Roda o navegador escondido.
 * @param {string}   [options.browser="chrome"]  "chrome" ou "chromium".
 * @param {number}   [options.maxTentativas=4]
 * @param {number}   [options.retryEsperaMs=4000]
 * @param {(evt:{level:string,message:string,timestamp:string})=>void} [options.onLog]
 * @param {(evt:{tipo:string, payload:any})=>void} [options.onEvent]
 * @param {AbortSignal} [options.signal]   Permite cancelar fechando o browser.
 * @returns {Promise<{excelPath:string|null, resultados:Array}>}
 */
export async function runAutomation(options) {
  const {
    turmas,
    email,
    password,
    manualGoogle = false,
    excelPath,
    headless = false,
    browser: tipoBrowser = "chrome",
    maxTentativas = 4,
    retryEsperaMs = 4000,
    chromeArgs = ["--disable-crash-reporter", "--disable-breakpad"],
    onLog,
    onEvent,
    signal,
  } = options;

  if (!Array.isArray(turmas) || turmas.length === 0) {
    throw new Error("Nenhuma turma informada.");
  }
  if (!email) {
    throw new Error("E-mail é obrigatório.");
  }

  const log = criarLogger(onLog, true);
  const emit = (tipo, payload) => {
    try { onEvent?.({ tipo, payload }); } catch { /* */ }
  };

  log.info(`Iniciando processamento de ${turmas.length} turma(s)…`);

  const usaChromium = tipoBrowser === "chromium" || tipoBrowser === "pw";
  const browser = await chromium.launch({
    headless,
    args: chromeArgs,
    ...(usaChromium ? {} : { channel: "chrome" }),
  });

  // Cancelamento: fecha o navegador ao receber abort.
  const onAbort = () => browser.close().catch(() => {});
  signal?.addEventListener?.("abort", onAbort);

  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(TIMEOUTS.default);

    await page.goto(GIP_BASE, { waitUntil: "domcontentloaded" });
    await page
      .waitForURL(GIP_AUTH_URL_REGEX, { timeout: TIMEOUTS.default })
      .catch(() => {});

    await realizarLogin(page, { email, password, manualGoogle, log });

    const workPage = await aguardarPosLogin(context);

    const resultados = [];

    for (let i = 0; i < turmas.length; i++) {
      if (signal?.aborted) {
        log.warn("Execução cancelada pelo usuário.");
        break;
      }
      const turma = turmas[i];
      log.info(`\n${"─".repeat(60)}`);
      log.info(`[${i + 1}/${turmas.length}] Processando turma ${turma.codigo} (${turma.empresa})`);
      log.info("─".repeat(60));
      emit("turma_inicio", { index: i, total: turmas.length, turma });

      const resultado = await processarTurma(workPage, turma, {
        maxTentativas,
        retryEsperaMs,
        log,
      });
      resultados.push(resultado);
      emit("turma_fim", { index: i, total: turmas.length, resultado });

      if (i < turmas.length - 1) {
        log.info("Voltando para o diretório de turmas…");
        const url = new URL(GIP_DIRETORIO_PATH, GIP_BASE).href;
        await workPage.goto(url, { waitUntil: "domcontentloaded" });
        await aguardarListaDeTurmas(workPage).catch(() => {});
      }
    }

    // Resumo final
    log.info(`\n${"═".repeat(60)}`);
    log.info("RESUMO FINAL");
    log.info("═".repeat(60));
    for (const { turma, alunos, erro, semAula, semListaChamadas } of resultados) {
      if (erro) {
        log.error(`  ✗ [${turma.empresa}] Turma ${turma.codigo}: ERRO — ${erro}`);
      } else if (semListaChamadas) {
        log.warn(`  - [${turma.empresa}] Turma ${turma.codigo}: turma não encontrada — sem lista de chamadas`);
      } else if (semAula) {
        log.warn(`  - [${turma.empresa}] Turma ${turma.codigo}: nenhuma aula encontrada (pulada)`);
      } else if (alunos.length === 0) {
        log.info(`  ✓ [${turma.empresa}] Turma ${turma.codigo}: todos presentes`);
      } else {
        log.warn(`  ! [${turma.empresa}] Turma ${turma.codigo}: ${alunos.length} ausente(s)`);
      }
    }
    log.info("═".repeat(60));

    let pathSalvo;
    try {
      pathSalvo = await salvarExcelCombinado(resultados, { excelPath, log });
    } catch (err) {
      log.error(`Falha ao salvar planilha: ${err?.message ?? err}`);
      emit("erro_planilha", { message: err?.message ?? String(err) });
      throw err;
    }

    emit("fim", { excelPath: pathSalvo, resultados });
    log.info("Fluxo concluído.");

    return { excelPath: pathSalvo, resultados };
  } finally {
    signal?.removeEventListener?.("abort", onAbort);
    await browser.close().catch(() => {});
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// CLI: só roda se executado diretamente via `node` (não quando importado)
// ──────────────────────────────────────────────────────────────────────────────

function ehExecucaoDireta() {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === new URL(`file://${process.argv[1]}`).href;
  } catch {
    return false;
  }
}

if (ehExecucaoDireta()) {
  const __filename = fileURLToPath(import.meta.url);
  void __filename;

  const opts = {
    turmas: TURMAS_PADRAO,
    email: process.env.GIP_EMAIL ?? "stephanie.silva@alicerceedu.com.br",
    password: process.env.GIP_PASSWORD,
    manualGoogle: /^(1|true|yes|on)$/i.test(process.env.GIP_MANUAL_GOOGLE_LOGIN ?? ""),
    browser: (process.env.GIP_BROWSER ?? "chrome").toLowerCase(),
    excelPath: process.env.GIP_EXCEL_PATH,
    maxTentativas: Number(process.env.GIP_TURMA_MAX_TENTATIVAS ?? 4),
    retryEsperaMs: Number(process.env.GIP_TURMA_ESPERA_MS ?? 4000),
    chromeArgs: process.env.GIP_CHROME_ARGS?.split(/\s+/).filter(Boolean),
  };

  runAutomation(opts).catch((err) => {
    console.error(`[GIP] ${err.message ?? err}`);
    process.exit(1);
  });
}
