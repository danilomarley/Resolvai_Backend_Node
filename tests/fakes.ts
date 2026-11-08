import type {
  CurrentUser,
  IArmazenamentoFotos,
  IAssistentePedido,
  MensagemChat,
  RespostaAssistente,
  IContatoRepository,
  IEspecialidadeQueries,
  IFornecedorRepository,
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
import type { StatusPedido, UserRole } from '../src/domain/enums.js';
import type { User } from '../src/domain/user.js';
import type { Fornecedor } from '../src/domain/fornecedor.js';
import type { FornecedorResponse } from '../src/application/dtos/fornecedores.js';

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

  async existsByCpf(cpf: string, excludingUserId: string, role: UserRole) {
    return [...this.users.values()].some(user => user.cpf === cpf && user.id !== excludingUserId && user.role === role);
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
  async getPrincipal(idUsuario: string) {
    return this.itens.find(item => item.idUsuario === idUsuario) ?? null;
  }
  async salvarPrincipal(endereco: Endereco) {
    const indice = this.itens.findIndex(item => item.idUsuario === endereco.idUsuario);
    if (indice >= 0) this.itens[indice] = endereco;
    else this.itens.push(endereco);
  }
}

export class FakeContatos implements IContatoRepository {
  readonly itens: Contato[] = [];
  async add(contato: Contato) {
    this.itens.push(contato);
  }
  async getPrincipal(idUsuario: string) {
    return this.itens.find(item => item.idUsuario === idUsuario) ?? null;
  }
  async salvarPrincipal(contato: Contato) {
    const indice = this.itens.findIndex(item => item.idUsuario === contato.idUsuario);
    if (indice >= 0) this.itens[indice] = contato;
    else this.itens.push(contato);
  }
}

export class FakeArmazenamento implements IArmazenamentoFotos {
  readonly removidos: string[] = [];
  async remover(caminhos: string[]) { this.removidos.push(...caminhos); }
  readonly enviados: { caminho: string; tamanho: number; contentType: string }[] = [];
  async enviar(caminho: string, conteudo: Buffer, contentType: string) {
    this.enviados.push({ caminho, tamanho: conteudo.length, contentType });
    return `https://projeto-teste.supabase.co/storage/v1/object/public/pedidos/${caminho}`;
  }
}

export class FakeAssistente implements IAssistentePedido {
  ultimaConversa: MensagemChat[] = [];
  resposta: RespostaAssistente = {
    resposta: 'Em qual bairro e cidade fica o imóvel?',
    escopo: { categoria: 'Elétrica', descricao: 'Tomada da cozinha sem energia.' },
    completo: false
  };
  erro?: Error;

  async responder(mensagens: MensagemChat[]) {
    if (this.erro) throw this.erro;
    this.ultimaConversa = mensagens;
    return this.resposta;
  }
}

export class FakeSupabase implements ISupabaseAuthClient {
  readonly recuperacoes: { email: string; redirectTo: string }[] = [];
  async requestPasswordRecovery(email: string, redirectTo: string) {
    if (this.erro) throw this.erro;
    this.recuperacoes.push({ email, redirectTo });
  }
  session?: SupabaseSession;
  novoUsuario?: SupabaseAuthUser;
  erro?: Error;

  async signInWithPassword() {
    if (this.erro) throw this.erro;
    if (!this.session) throw new Error('Sessão não configurada no fake.');
    return this.session;
  }

  async refreshSession() { return this.signInWithPassword(); }

  async signUp(email: string) {
    if (this.erro) throw this.erro;
    return this.novoUsuario ?? { id: crypto.randomUUID(), email };
  }

  async adminCreateUser(email: string) {
    return this.signUp(email);
  }

  readonly senhasAlteradas: { userId: string; password: string }[] = [];
  async adminUpdatePassword(userId: string, password: string) {
    if (this.erro) throw this.erro;
    this.senhasAlteradas.push({ userId, password });
  }
}

export class FakeEspecialidades implements IEspecialidadeQueries {
  async listActive() { return [{ codigo: 'eletrica', nome: 'Elétrica' }]; }
}

export class FakeFornecedores implements IFornecedorRepository {
  readonly profiles = new Map<string, FornecedorResponse>();
  async existsByCnpj(cnpj: string) { return [...this.profiles.values()].some(p => p.cnpj === cnpj); }
  async getByUsuarioId(id: string) { return this.profiles.get(id) ?? null; }
  async addComplete(user: User, fornecedor: Fornecedor, contato: Contato, especialidades: string[]) {
    this.profiles.set(user.id, { ...fornecedor.dados, idUsuario: user.id, name: user.name, email: user.email.value,
      cpf: user.cpf ?? undefined, tipoPessoa: fornecedor.tipoPessoa, cnpj: fornecedor.cnpj, telefone: contato.valor,
      especialidades, bio: fornecedor.dados.bio ?? null, registroProfissional: fornecedor.dados.registroProfissional ?? null,
      createdAt: new Date().toISOString(), updatedAt: null });
  }
  async updateComplete(user: User, fornecedor: Fornecedor, contato: Contato, especialidades: string[]) {
    return this.addComplete(user, fornecedor, contato, especialidades);
  }
}
