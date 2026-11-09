import { DomainException } from '../../domain/errors.js';
import type { CurrentUser, IFornecedorRepository, IUserRepository } from '../contracts.js';
import type { FornecedorResponse } from '../dtos/fornecedores.js';
import type { User } from '../../domain/user.js';
import type { PaginaResponse } from '../dtos/common.js';
import type {
  AtualizarPerfilPrestador,
  CategoriaServico,
  ListarFeedQuery,
  PedidoFeedItem,
  PedidoPrestadorResponse,
  PerfilPrestador,
  ResumoPrestador
} from '../dtos/prestador.js';
import { NotFoundException, UnauthorizedException } from '../errors.js';

const guidVazio = '00000000-0000-0000-0000-000000000000';

export interface FiltroFeed {
  category?: string;
  city?: string;
  urgency?: string;
  q?: string;
  compatible?: boolean;
}

export interface IPrestadorRepository {
  listCategorias(): Promise<CategoriaServico[]>;
  getPerfil(prestadorId: string): Promise<Pick<PerfilPrestador, 'categories' | 'cities'>>;
  savePerfil(prestadorId: string, categoryIds: string[], cities: string[]): Promise<'ok' | 'invalidCategory' | 'incomplete'>;
  getResumo(prestadorId: string): Promise<ResumoPrestador>;
  listFeed(prestadorId: string, filtro: FiltroFeed, page: number, pageSize: number): Promise<PaginaResponse<PedidoFeedItem>>;
  /** null quando o pedido não existe ou o prestador não pode vê-lo. */
  getPedido(prestadorId: string, orderId: string): Promise<PedidoPrestadorResponse | null>;
}

/** Minúsculas e sem acento, compatível com a normalização das consultas SQL. */
export const normalizarTexto = (texto: string) => texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/**
 * Perfil profissional, feed e detalhe de pedidos do prestador. Rotas protegidas por exigirPrestador.
 */
export class PrestadorService {
  constructor(
    private readonly repository: IPrestadorRepository,
    private readonly users: IUserRepository,
    private readonly fornecedores?: Pick<IFornecedorRepository, 'getByUsuarioId'>
  ) {}

  listarCategorias(): Promise<CategoriaServico[]> {
    return this.repository.listCategorias();
  }

  async perfil(currentUser: CurrentUser): Promise<PerfilPrestador> {
    const id = getUserId(currentUser);
    const [dados, usuario, fornecedor] = await Promise.all([
      this.repository.getPerfil(id), this.users.getById(id), this.fornecedores?.getByUsuarioId(id)
    ]);
    const registrationComplete = cadastroProfissionalCompleto(usuario, fornecedor ?? null);
    return {
      ...dados,
      registrationComplete,
      onboardingComplete: registrationComplete && dados.categories.length > 0 && dados.cities.length > 0
    };
  }

  async atualizarPerfil(currentUser: CurrentUser, request: AtualizarPerfilPrestador): Promise<PerfilPrestador> {
    const id = getUserId(currentUser);

    // Mesma cidade escrita de formas diferentes ("Fortaleza", "fortaleza ") vira uma só.
    const vistas = new Set<string>();
    const cities = request.cities
      .map(cidade => cidade.trim().replace(/\s+/g, ' '))
      .filter(cidade => {
        const chave = normalizarTexto(cidade);
        if (vistas.has(chave)) return false;
        vistas.add(chave);
        return true;
      });
    const categoryIds = [...new Set(request.categoryIds.map(item => item.toLowerCase()))];

    if (cities.length !== 1) throw new DomainException('Informe somente a cidade principal de atuação.');
    const result = await this.repository.savePerfil(id, categoryIds, cities);
    if (result === 'incomplete') throw new DomainException('Finalize o cadastro profissional antes de editar as especialidades e a cidade.');
    if (result === 'invalidCategory') {
      throw new DomainException('Escolha apenas categorias disponíveis no catálogo.');
    }

    return this.perfil(currentUser);
  }

  resumo(currentUser: CurrentUser): Promise<ResumoPrestador> {
    return this.repository.getResumo(getUserId(currentUser));
  }

  feed(currentUser: CurrentUser, query: ListarFeedQuery): Promise<PaginaResponse<PedidoFeedItem>> {
    const texto = (valor: string | undefined) => valor?.trim() || undefined;
    return this.repository.listFeed(
      getUserId(currentUser),
      {
        category: texto(query.category)?.toLowerCase(),
        city: texto(query.city),
        urgency: texto(query.urgency),
        q: texto(query.q),
        compatible: query.compatible === 'true'
      },
      query.page,
      query.pageSize
    );
  }

  async pedido(currentUser: CurrentUser, orderId: string): Promise<PedidoPrestadorResponse> {
    const pedido = await this.repository.getPedido(getUserId(currentUser), orderId);
    if (!pedido) {
      throw new NotFoundException('Pedido', orderId);
    }

    return pedido;
  }
}

/** Existing PF accounts retain their CPF; new professional profiles use the corresponding PF/PJ document. */
export function cadastroProfissionalCompleto(usuario: Pick<User, 'cpf'> | null, fornecedor: FornecedorResponse | null): boolean {
  if (!fornecedor) return false;
  if (fornecedor?.tipoPessoa === 'PJ') return !!fornecedor.cnpj?.trim();
  return !!usuario?.cpf?.trim();
}

export function getUserId(currentUser: CurrentUser): string {
  if (currentUser.isAuthenticated && currentUser.id && currentUser.id !== guidVazio) {
    return currentUser.id;
  }

  throw new UnauthorizedException('Token sem identificação de usuário.');
}
