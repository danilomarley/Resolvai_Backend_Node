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
