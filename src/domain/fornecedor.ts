import { normalizarCnpj, normalizarCpf } from './documentos.js';
import { DomainException } from './errors.js';

export interface DadosProfissionais {
  nomeExibicao: string;
  cidadeAtuacao: string;
  cidadesAtuacao?: string[];
  ufAtuacao: string;
  raioAtendimentoKm: number;
  bio?: string | null;
  registroProfissional?: string | null;
}

const ufs = new Set('AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' '));

export class Fornecedor {
  private constructor(
    readonly idUsuario: string,
    readonly tipoPessoa: 'PF' | 'PJ',
    readonly cnpj: string | null,
    readonly dados: DadosProfissionais
  ) {}

  static register(idUsuario: string, tipoPessoa: 'PF' | 'PJ', cnpj: string | null | undefined, dados: DadosProfissionais): Fornecedor {
    if (!idUsuario || !['PF', 'PJ'].includes(tipoPessoa)) throw new DomainException('Tipo de pessoa inválido.');
    if (!dados.nomeExibicao.trim() || dados.nomeExibicao.length > 200 || !dados.cidadeAtuacao.trim() || dados.cidadeAtuacao.length > 120) {
      throw new DomainException('Informe nome de exibição e cidade válidos.');
    }
    const ufAtuacao = dados.ufAtuacao.trim().toUpperCase();
    if (!ufs.has(ufAtuacao)) throw new DomainException('UF de atuação inválida.');
    if (!Number.isInteger(dados.raioAtendimentoKm) || dados.raioAtendimentoKm < 1 || dados.raioAtendimentoKm > 200) {
      throw new DomainException('O raio de atendimento deve estar entre 1 e 200 km.');
    }
    const bio = dados.bio?.trim() || null;
    const registroProfissional = dados.registroProfissional?.trim() || null;
    if ((bio?.length ?? 0) > 360 || (registroProfissional?.length ?? 0) > 80) throw new DomainException('Bio ou registro profissional excede o limite.');
    if (tipoPessoa === 'PF' && cnpj?.trim()) throw new DomainException('Pessoa física não pode informar CNPJ.');
    const documento = tipoPessoa === 'PJ' ? normalizarCnpj(cnpj) : null;
    if (tipoPessoa === 'PJ' && !documento) throw new DomainException('CNPJ inválido.');
    const cidades = new Map<string, string>();
    for (const value of [dados.cidadeAtuacao, ...(dados.cidadesAtuacao ?? [])]) {
      const cidade = value.trim().replace(/\s+/g, ' ');
      if (!cidade || cidade.length > 120) throw new DomainException('Informe cidades de atuação com até 120 caracteres.');
      const chave = cidade.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      if (!cidades.has(chave)) cidades.set(chave, cidade);
    }
    if (cidades.size > 1) throw new DomainException('Informe somente a cidade principal de atuação.');
    return new Fornecedor(idUsuario, tipoPessoa, documento, {
      ...dados, nomeExibicao: dados.nomeExibicao.trim(), cidadeAtuacao: dados.cidadeAtuacao.trim(), cidadesAtuacao: [...cidades.values()], ufAtuacao, bio, registroProfissional
    });
  }

  normalizeCpf(value?: string | null): string | null {
    if (this.tipoPessoa === 'PJ') {
      if (value?.trim()) throw new DomainException('Pessoa jurídica não pode informar CPF.');
      return null;
    }
    const cpf = normalizarCpf(value);
    if (!cpf) throw new DomainException('CPF inválido.');
    return cpf;
  }
}
