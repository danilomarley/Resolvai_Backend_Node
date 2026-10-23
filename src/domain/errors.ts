/**
 * Violação de uma regra ou invariante do domínio. Vira 400 na API.
 */
export class DomainException extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DomainException';
  }
}

export class InvalidEmailException extends DomainException {
  constructor(value: string | null | undefined) {
    super(`O e-mail informado é inválido: '${value ?? ''}'.`);
    this.name = 'InvalidEmailException';
  }
}
