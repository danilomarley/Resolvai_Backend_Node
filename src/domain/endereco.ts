import { randomUUID } from 'node:crypto';
import { DomainException } from './errors.js';

export interface DadosEndereco {
  logradouro: string;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cidade: string;
  estado: string;
  cep: string;
  apelido?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  principal: boolean;
}

export class Endereco {
  private constructor(
    readonly id: string,
    readonly idUsuario: string,
    readonly logradouro: string,
    readonly numero: string | null,
    readonly complemento: string | null,
    readonly bairro: string | null,
    readonly cidade: string,
    readonly estado: string,
    readonly cep: string,
    readonly apelido: string | null,
    readonly latitude: number | null,
    readonly longitude: number | null,
    readonly principal: boolean
  ) {}

  static register(idUsuario: string, dados: DadosEndereco): Endereco {
    if (!dados.logradouro?.trim()) {
      throw new DomainException('O logradouro é obrigatório.');
    }

    if (!dados.cidade?.trim()) {
      throw new DomainException('A cidade é obrigatória.');
    }

    if (!dados.estado?.trim()) {
      throw new DomainException('O estado é obrigatório.');
    }

    if (!dados.cep?.trim()) {
      throw new DomainException('O CEP é obrigatório.');
    }

    return new Endereco(
      randomUUID(),
      idUsuario,
      dados.logradouro.trim(),
      dados.numero?.trim() ?? null,
      dados.complemento?.trim() ?? null,
      dados.bairro?.trim() ?? null,
      dados.cidade.trim(),
      dados.estado.trim(),
      dados.cep.trim(),
      dados.apelido?.trim() ?? null,
      dados.latitude ?? null,
      dados.longitude ?? null,
      dados.principal
    );
  }
}
