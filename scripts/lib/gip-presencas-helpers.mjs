/**
 * Helpers puros para a automação GIP (facilitam testes e uso compartilhado).
 */

export function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Monta uma linha da aba "Resumo" a partir do resultado parcial de uma turma.
 *
 * Flags suportadas:
 *   - erro: falha técnica (fluxo ausente/botões, etc.)
 *   - semListaChamadas: turma não localizada no diretório (usuário quer continuar execução)
 *   - semAula: nenhuma aula na data/horário disponível para presença
 *
 * @param {{ turma: { codigo: string, empresa: string }, alunos?: Array<{ nome: string }>, erro?: string | null, semAula?: boolean, semListaChamadas?: boolean }} resultado
 * @param {string} dataHora
 */
export function montarLinhaResumo(resultado, dataHora) {
  const { turma, alunos = [], erro, semAula, semListaChamadas } = resultado;

  /** @type {string | number} */
  let total;
  /** @type {string} */
  let status;

  if (erro) {
    total = "ERRO";
    status = String(erro);
  } else if (semListaChamadas) {
    total = "-";
    status = "— Turma não encontrada (sem lista de chamadas)";
  } else if (semAula) {
    total = "-";
    status = "— Nenhuma aula encontrada";
  } else if (alunos.length === 0) {
    total = 0;
    status = "✓ Todos presentes";
  } else {
    total = alunos.length;
    status = `${alunos.length} ausente(s)`;
  }

  return {
    empresa: turma.empresa,
    turma: turma.codigo,
    total,
    status,
    dataHora,
  };
}

/**
 * Indica se a planilha de detalhe (por empresa) deve incluir dados deste resultado.
 * Excluímos erros, turmas só com resumo, e turmas onde não há lista de chamadas ou ausências.
 *
 * @param {{ alunos?: Array<unknown>, erro?: string | null, semListaChamadas?: boolean }} resultado
 */
export function deveGerarLinhasDetalhe(resultado) {
  const alunos = resultado.alunos ?? [];
  if (resultado.erro) return false;
  if (resultado.semListaChamadas) return false;
  if (alunos.length === 0) return false;
  return true;
}
