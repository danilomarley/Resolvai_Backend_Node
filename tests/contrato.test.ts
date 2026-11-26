import { describe, expect, it } from 'vitest';
import { gerarTextoContrato, hashDoContrato, mascararDocumento, versaoModeloContrato, type DadosContrato } from '../src/domain/contrato.js';

const dados = (extra: Partial<DadosContrato['proposta']> = {}, pedido: Partial<DadosContrato['pedido']> = {}): DadosContrato => ({
  contratante: { nome: 'Maria Cliente', documento: '11122233344' },
  prestador: { nome: 'Ana Eletricista', documento: '12345678000199' },
  pedido: {
    titulo: 'Trocar o chuveiro',
    categoria: 'Elétrica',
    descricao: 'O chuveiro queimou e precisa de troca.',
    localizacao: 'Meireles, Fortaleza',
    detalhes: 'Banheiro social',
    especificacoes: 'Trocar o chuveiro e testar a instalação',
    urgencia: 'Urgente',
    ...pedido
  },
  proposta: { valor: 1234.5, prazo: '3 dias úteis', garantia: '90 dias', garantiaCondicoes: 'Não cobre mau uso', materiais: 'Chuveiro incluso', dataInicio: '2026-12-01', descricao: 'Instalação completa', ...extra },
  geradoEm: new Date('2026-11-26T15:00:00Z')
});

describe('contrato de prestação de serviços (#95)', () => {
  it('traz as partes, o serviço, o valor, o prazo e a garantia da proposta aceita', () => {
    const texto = gerarTextoContrato(dados());
    expect(texto).toContain('CONTRATO DE PRESTAÇÃO DE SERVIÇOS');
    expect(texto).toContain(`versão ${versaoModeloContrato}`);
    expect(texto).toContain('Gerado em 26/11/2026');
    expect(texto).toContain('CONTRATANTE: Maria Cliente, CPF ***.222.333-**.');
    expect(texto).toContain('PRESTADOR: Ana Eletricista, CNPJ **.***.***/0001-**.');
    expect(texto).toContain('o serviço "Trocar o chuveiro" (Elétrica), no local Meireles, Fortaleza');
    expect(texto).toContain('Escopo solicitado: Trocar o chuveiro e testar a instalação');
    expect(texto).toMatch(/O valor total do serviço é de R\$\s?1\.234,50\./);
    expect(texto).toContain('Prazo de execução: 3 dias úteis');
    expect(texto).toContain('Garantia do serviço: 90 dias.');
    expect(texto).toContain('Condições da garantia: Não cobre mau uso');
    expect(texto).toContain('Materiais: Chuveiro incluso');
    expect(texto).toContain('Início previsto: 01/12/2026.');
    for (const n of Array.from({ length: 12 }, (_, i) => i + 1)) expect(texto).toContain(`CLÁUSULA ${n} –`);
  });

  it('nunca mostra o documento inteiro das partes', () => {
    const texto = gerarTextoContrato(dados());
    expect(texto).not.toContain('11122233344');
    expect(texto).not.toContain('12345678000199');
    expect(texto).not.toContain('111.222.333');
  });

  it('diz que falta o que a proposta não informou, em vez de inventar prazo ou garantia', () => {
    const texto = gerarTextoContrato(dados({ prazo: null, garantia: '  ', garantiaCondicoes: null, materiais: null, dataInicio: null, descricao: null }, { categoria: null, localizacao: null, detalhes: null, especificacoes: null, urgencia: null }));
    expect(texto).toContain('Prazo de execução: a combinar entre as partes');
    expect(texto).toContain('Garantia do serviço: não informada na proposta.');
    expect(texto).not.toContain('Condições da garantia');
    expect(texto).not.toContain('Materiais:');
    expect(texto).not.toContain('Início previsto');
    expect(texto).toContain('o serviço "Trocar o chuveiro", conforme o escopo abaixo.');
  });

  it('o texto e o hash são estáveis para os mesmos dados e mudam quando algo muda', () => {
    const base = gerarTextoContrato(dados());
    expect(gerarTextoContrato(dados())).toBe(base);
    expect(hashDoContrato(base)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashDoContrato(base)).toBe(hashDoContrato(gerarTextoContrato(dados())));
    expect(hashDoContrato(gerarTextoContrato(dados({ valor: 1235 })))).not.toBe(hashDoContrato(base));
  });

  it('mascara CPF, CNPJ e documento ausente', () => {
    expect(mascararDocumento('111.222.333-44')).toBe('CPF ***.222.333-**');
    expect(mascararDocumento('AB12CD34000155')).toBe('CNPJ **.***.***/0001-**');
    expect(mascararDocumento(null)).toBe('documento não informado');
    expect(mascararDocumento('123')).toBe('documento não informado');
  });
});
