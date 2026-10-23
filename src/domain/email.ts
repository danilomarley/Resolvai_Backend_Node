import { InvalidEmailException } from './errors.js';

// Aproxima o System.Net.Mail.MailAddress usado na API C#: local@domínio, sem espaços nem caracteres especiais de endereço.
const formatoEmail = /^[^\s@"(),:;<>[\\\]]+@[^\s@"(),:;<>[\\\]]+$/;

/**
 * E-mail sempre normalizado em minúsculas, para casar com a coluna citext do PostgreSQL.
 */
export class Email {
  static readonly maxLength = 320;

  private constructor(readonly value: string) {}

  static create(value: string | null | undefined): Email {
    const email = Email.tryCreate(value);
    if (!email) {
      throw new InvalidEmailException(value);
    }

    return email;
  }

  static tryCreate(value: string | null | undefined): Email | undefined {
    if (!value || !value.trim()) {
      return undefined;
    }

    const normalized = value.trim().toLowerCase();
    if (normalized.length > Email.maxLength || !formatoEmail.test(normalized)) {
      return undefined;
    }

    return new Email(normalized);
  }

  toString(): string {
    return this.value;
  }
}
