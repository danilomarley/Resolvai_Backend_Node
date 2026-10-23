import type { Contato } from '../domain/contato.js';
import type { Email } from '../domain/email.js';
import type { Endereco } from '../domain/endereco.js';
import type { StatusPedido, UserRole } from '../domain/enums.js';
import type { User } from '../domain/user.js';
import type { PaginaResponse } from './dtos/common.js';
import type { ResumoHomeResponse } from './dtos/home.js';
import type { NovaFotoPedidoRequest, PedidoResponse, PedidoResumoResponse } from './dtos/pedidos.js';

/**
 * Portador do Bearer token da requisição atual (equivalente ao ICurrentUser da API C#).
 */
export interface CurrentUser {
  isAuthenticated: boolean;
  id?: string;
  email?: string;
  role?: UserRole;
}

export const usuarioAnonimo: CurrentUser = { isAuthenticated: false };

export interface IUserRepository {
  getById(id: string): Promise<User | null>;
  getByEmail(email: Email): Promise<User | null>;
  existsByEmail(email: Email): Promise<boolean>;
  existsByCpf(cpf: string, excludingUserId: string): Promise<boolean>;
  getAll(): Promise<User[]>;
  add(user: User): Promise<void>;
  update(user: User): Promise<void>;
}

export interface IEnderecoRepository {
  add(endereco: Endereco): Promise<void>;
}

export interface IContatoRepository {
  add(contato: Contato): Promise<void>;
}

// Consultas de leitura retornam projeções, sem carregar agregados desnecessários.
export interface IPedidoQueries {
  list(userId: string, status: StatusPedido | undefined, page: number, pageSize: number): Promise<PaginaResponse<PedidoResumoResponse>>;
  getById(id: string, userId: string): Promise<PedidoResponse | null>;
  getSummary(userId: string): Promise<ResumoHomeResponse>;
}

export interface IPedidoRepository {
  add(id: string, idCliente: string, escopoJson: string, fotos: NovaFotoPedidoRequest[]): Promise<void>;
}

export interface SupabaseAuthUser {
  id: string;
  email: string;
}

export interface SupabaseSession {
  accessToken: string;
  tokenType: string;
  expiresAtUtc: Date;
  refreshToken: string | null;
  user: SupabaseAuthUser;
}

export interface ISupabaseAuthClient {
  signInWithPassword(email: string, password: string): Promise<SupabaseSession>;
  signUp(email: string, password: string, name: string): Promise<SupabaseAuthUser>;
  adminCreateUser(email: string, password: string, name: string): Promise<SupabaseAuthUser>;
}
