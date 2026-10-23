import type {
  CurrentUser,
  IContatoRepository,
  IEnderecoRepository,
  IPedidoQueries,
  IPedidoRepository,
  ISupabaseAuthClient,
  IUserRepository,
  SupabaseAuthUser,
  SupabaseSession
} from '../src/application/contracts.js';
import { criarPagina, type PaginaResponse } from '../src/application/dtos/common.js';
import type { ResumoHomeResponse } from '../src/application/dtos/home.js';
import type { NovaFotoPedidoRequest, PedidoResponse, PedidoResumoResponse } from '../src/application/dtos/pedidos.js';
import type { Contato } from '../src/domain/contato.js';
import type { Email } from '../src/domain/email.js';
import type { Endereco } from '../src/domain/endereco.js';
import type { StatusPedido } from '../src/domain/enums.js';
import type { User } from '../src/domain/user.js';

export const usuario = (id?: string, extra: Partial<CurrentUser> = {}): CurrentUser => ({
  isAuthenticated: true,
  id,
  ...extra
});

export function pedidoDeTeste(id: string): PedidoResponse {
  return {
    id,
    title: 'Pedido',
    description: 'Descrição',
    status: 'Pending',
    createdAt: new Date().toISOString(),
    photos: [],
    proposals: []
  };
}

export class FakeQueries implements IPedidoQueries {
  pedido: PedidoResponse | null = null;
  readonly pagina: PaginaResponse<PedidoResumoResponse> = criarPagina([], 1, 10, 0);
  lastPedidoId?: string;
  lastStatus?: StatusPedido;
  lastPage?: number;
  lastPageSize?: number;
  lastUserId?: string;
  calls = 0;

  async list(userId: string, status: StatusPedido | undefined, page: number, pageSize: number) {
    [this.lastStatus, this.lastPage, this.lastPageSize] = [status, page, pageSize];
    this.record(userId);
    return this.pagina;
  }

  async getById(id: string, userId: string) {
    this.lastPedidoId = id;
    this.record(userId);
    return this.pedido;
  }

  async getSummary(userId: string): Promise<ResumoHomeResponse> {
    this.record(userId);
    return {
      orders: { total: 0, pending: 0, inProgress: 0, completed: 0, cancelled: 0, active: 0, createdLast7Days: 0 },
      proposals: { total: 0, awaitingDecision: 0, unviewed: 0 },
      recentOrders: []
    };
  }

  private record(userId: string) {
    this.calls++;
    this.lastUserId = userId;
  }
}

export class FakePedidoRepository implements IPedidoRepository {
  added = 0;
  lastClienteId?: string;
  lastEscopo?: string;
  lastFotos = 0;

  async add(_id: string, idCliente: string, escopoJson: string, fotos: NovaFotoPedidoRequest[]) {
    this.added++;
    this.lastClienteId = idCliente;
    this.lastEscopo = escopoJson;
    this.lastFotos = fotos.length;
  }
}

export class FakeUsers implements IUserRepository {
  readonly users = new Map<string, User>();
  updates = 0;

  set user(user: User | null) {
    this.users.clear();
    if (user) this.users.set(user.id, user);
  }

  async getById(id: string) {
    return this.users.get(id) ?? null;
  }

  async getByEmail(email: Email) {
    return [...this.users.values()].find(user => user.email.value === email.value) ?? null;
  }

  async existsByEmail(email: Email) {
    return (await this.getByEmail(email)) !== null;
  }

  async existsByCpf(cpf: string, excludingUserId: string) {
    return [...this.users.values()].some(user => user.cpf === cpf && user.id !== excludingUserId);
  }

  async getAll() {
    return [...this.users.values()];
  }

  async add(user: User) {
    this.users.set(user.id, user);
  }

  async update(user: User) {
    this.updates++;
    this.users.set(user.id, user);
  }
}

export class FakeEnderecos implements IEnderecoRepository {
  readonly itens: Endereco[] = [];
  async add(endereco: Endereco) {
    this.itens.push(endereco);
  }
}

export class FakeContatos implements IContatoRepository {
  readonly itens: Contato[] = [];
  async add(contato: Contato) {
    this.itens.push(contato);
  }
}

export class FakeSupabase implements ISupabaseAuthClient {
  session?: SupabaseSession;
  novoUsuario?: SupabaseAuthUser;
  erro?: Error;

  async signInWithPassword() {
    if (this.erro) throw this.erro;
    if (!this.session) throw new Error('Sessão não configurada no fake.');
    return this.session;
  }

  async signUp(email: string) {
    if (this.erro) throw this.erro;
    return this.novoUsuario ?? { id: crypto.randomUUID(), email };
  }

  async adminCreateUser(email: string) {
    return this.signUp(email);
  }
}
