/**
 * Log persistido em disco (audit/debug), independente da UI.
 * Diretório: <userData>/logs/automatizador-YYYY-MM-DD.log (UTF-8, append).
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

/** @returns {string} */
function dayStamp(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

/**
 * Grava uma linha de log textual; cria pasta se necessário.
 * Falhas são engolidas para nunca afetar a automação.
 *
 * @param {Electron.App | { getPath: (what: string) => string }} app
 * @param {"trace"|"debug"|"info"|"warn"|"error"} level
 * @param {string} message
 * @param {Record<string, unknown> | undefined} meta
 */
function appendAppLog(app, level, message, meta = undefined) {
  try {
    const dir = path.join(app.getPath("userData"), "logs");
    fs.mkdirSync(dir, { recursive: true });

    const file = path.join(dir, `automatizador-${dayStamp()}.log`);
    const ts = new Date().toISOString();
    let line = `[${ts}] [${level.toUpperCase()}] ${message}`;
    if (meta && Object.keys(meta).length > 0) {
      line += ` | ${safeJson(meta)}`;
    }
    fs.appendFileSync(file, `${line}\n`, "utf8");
  } catch (_) {
    // Intencional: logging em arquivo não pode derrubar o app.
  }
}

function safeJson(obj) {
  try {
    return JSON.stringify(obj);
  } catch {
    return "{}";
  }
}

module.exports = { appendAppLog, dayStamp };
