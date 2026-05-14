import { describe, expect, it } from "vitest";
import {
  escapeRegex,
  montarLinhaResumo,
  deveGerarLinhasDetalhe,
} from "../scripts/lib/gip-presencas-helpers.mjs";

describe("escapeRegex", () => {
  it("neutraliza caracteres especiais como literais dentro de uma RegExp", () => {
    expect(escapeRegex("a+b")).toBe("a\\+b");
    expect(escapeRegex("nome (teste)")).toContain("\\(");
    expect(escapeRegex(".")).toBe("\\.");
    const pattern = new RegExp(`^${escapeRegex("(x)")}$`);
    expect(pattern.test("(x)")).toBe(true);
  });
});

describe("montarLinhaResumo", () => {
  const turmaBase = () => ({ codigo: "1234", empresa: "ACME" });
  const agora = "14/05/2026 10:30:00";

  it("marcar turma não encontrada sem ERRO técnico", () => {
    const row = montarLinhaResumo(
      { turma: turmaBase(), alunos: [], semListaChamadas: true },
      agora
    );
    expect(row.total).toBe("-");
    expect(row.status).toContain("lista de chamadas");
    expect(row.empresa).toBe("ACME");
    expect(row.turma).toBe("1234");
  });

  it("falhas técnicas continuam marcadas como ERRO", () => {
    const row = montarLinhaResumo(
      {
        turma: turmaBase(),
        alunos: [],
        erro: "timeout",
      },
      agora
    );
    expect(row.total).toBe("ERRO");
    expect(row.status).toBe("timeout");
  });

  it("lista presente completa quando zero ausências", () => {
    const row = montarLinhaResumo(
      { turma: turmaBase(), alunos: [] },
      agora
    );
    expect(row.total).toBe(0);
    expect(row.status).toContain("presentes");
  });

  it("lista ausências com contagem positiva", () => {
    const row = montarLinhaResumo(
      {
        turma: turmaBase(),
        alunos: [{ nome: "Fulano", telefone: "11" }],
      },
      agora
    );
    expect(row.total).toBe(1);
    expect(row.status).toContain("ausente(s)");
  });
});

describe("deveGerarLinhasDetalhe", () => {
  const turma = { codigo: "X", empresa: "Y" };

  it("não gerar quando sem lista ou sem dados", () => {
    expect(
      deveGerarLinhasDetalhe({ turma, alunos: [], semListaChamadas: true })
    ).toBe(false);
    expect(deveGerarLinhasDetalhe({ turma, alunos: [] })).toBe(false);
    expect(deveGerarLinhasDetalhe({ turma, erro: "falhou" })).toBe(false);
  });

  it("gerar quando há ausências coletadas", () => {
    expect(
      deveGerarLinhasDetalhe({
        turma,
        alunos: [{ nome: "Z", telefone: "" }],
      })
    ).toBe(true);
  });
});
