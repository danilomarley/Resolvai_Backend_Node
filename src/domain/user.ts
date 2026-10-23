import type { Email } from './email.js';
import type { UserRole } from './enums.js';
import { DomainException } from './errors.js';

const guidVazio = '00000000-0000-0000-0000-000000000000';

export class User {
  private constructor(
    readonly id: string,
    private _name: string,
    readonly email: Email,
    private _role: UserRole,
    private _isActive: boolean,
    readonly createdAt: Date,
    private _updatedAt: Date | null,
    private _cpf: string | null
  ) {}

  get name(): string {
    return this._name;
  }

  get role(): UserRole {
    return this._role;
  }

  get isActive(): boolean {
    return this._isActive;
  }

  get cpf(): string | null {
    return this._cpf;
  }

  get updatedAt(): Date | null {
    return this._updatedAt;
  }

  /**
   * Cria o perfil local vinculado a um usuário já autenticado no Supabase Auth.
   * O id deve ser o mesmo UUID de auth.users.
   */
  static register(id: string, name: string, email: Email, role: UserRole): User {
    if (!id || id === guidVazio) {
      throw new DomainException('O identificador do usuário é obrigatório.');
    }

    if (!name || !name.trim()) {
      throw new DomainException('O nome do usuário é obrigatório.');
    }

    return new User(id, name.trim(), email, role, true, new Date(), null, null);
  }

  /**
   * Reidrata um usuário já persistido. Uso exclusivo da camada de persistência.
   */
  static restore(
    id: string,
    name: string,
    email: Email,
    role: UserRole,
    isActive: boolean,
    createdAt: Date,
    updatedAt: Date | null,
    cpf: string | null = null
  ): User {
    return new User(id, name, email, role, isActive, createdAt, updatedAt, cpf);
  }

  changeName(name: string): void {
    if (!name || !name.trim()) {
      throw new DomainException('O nome do usuário é obrigatório.');
    }

    this._name = name.trim();
    this.touch();
  }

  changeRole(role: UserRole): void {
    this._role = role;
    this.touch();
  }

  /**
   * Finaliza o cadastro gravando o CPF do usuário. Só pode ser feito uma vez.
   */
  completeRegistration(cpf: string): void {
    const digits = cpf.replace(/\D/g, '');
    if (digits.length !== 11) {
      throw new DomainException('CPF inválido.');
    }

    this._cpf = digits;
    this.touch();
  }

  activate(): void {
    if (this._isActive) {
      return;
    }

    this._isActive = true;
    this.touch();
  }

  deactivate(): void {
    if (!this._isActive) {
      return;
    }

    this._isActive = false;
    this.touch();
  }

  private touch(): void {
    this._updatedAt = new Date();
  }
}
