import { randomUUID } from 'node:crypto';
import { DomainException } from './errors.js';

export const tiposContato = ['telefone', 'whatsapp', 'email_alt'] as const;

export type TipoContato = (typeof tiposContato)[number];

export class Contato {
  private constructor(
    readonly id: string,
    readonly idUsuario: string,
    readonly tipo: string,
    readonly valor: string,
    readonly principal: boolean
  ) {}

  static register(idUsuario: string, tipo: string, valor: string, principal: boolean): Contato {
    if (!tipo?.trim() || !(tiposContato as readonly string[]).includes(tipo)) {
      throw new DomainException("O tipo de contato deve ser 'telefone', 'whatsapp' ou 'email_alt'.");
    }

    if (!valor?.trim()) {
      throw new DomainException('O valor do contato é obrigatório.');
    }

    return new Contato(randomUUID(), idUsuario, tipo, valor.trim(), principal);
  }
}
