export class UnauthorizedException extends Error {
  constructor(message = 'Credenciais inválidas.') {
    super(message);
    this.name = 'UnauthorizedException';
  }
}

export class NotFoundException extends Error {
  constructor(resource: string, key: unknown) {
    super(`${resource} '${String(key)}' não foi encontrado.`);
    this.name = 'NotFoundException';
  }
}

export class ConflictException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictException';
  }
}

/**
 * Dependência externa indisponível ou não configurada (vira 503).
 */
export class ServicoIndisponivelException extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ServicoIndisponivelException';
  }
}

/**
 * Limite de tentativas excedido (vira 429).
 */
export class MuitasTentativasException extends Error {
  constructor(message = 'Muitas tentativas. Aguarde alguns minutos e tente novamente.') {
    super(message);
    this.name = 'MuitasTentativasException';
  }
}
