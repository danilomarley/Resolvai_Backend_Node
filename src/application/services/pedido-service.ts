import { randomUUID } from 'node:crypto';
import { UserRole } from '../../domain/enums.js';
import { DomainException } from '../../domain/errors.js';
import type { CurrentUser, IPedidoQueries, IPedidoRepository, IUserRepository } from '../contracts.js';
import type { PaginaResponse } from '../dtos/common.js';
import type { ResumoHomeResponse } from '../dtos/home.js';
import type { CriarPedidoRequest, ListarPedidosQuery, PedidoResponse, PedidoResumoResponse } from '../dtos/pedidos.js';
import { NotFoundException, UnauthorizedException } from '../errors.js';

const guidVazio = '00000000-0000-0000-0000-000000000000';

export class PedidoService {
  constructor(
    private readonly pedidos: IPedidoQueries,
    private readonly pedidoRepository: IPedidoRepository,
    private readonly userRepository: IUserRepository
  ) {}

  async criar(currentUser: CurrentUser, request: CriarPedidoRequest): Promise<PedidoResponse> {
    const userId = getUserId(currentUser);
    const user = await this.userRepository.getById(userId);

    if (!user || !user.cpf?.trim()) {
      throw new DomainException('Finalize o cadastro antes de criar um pedido.');
    }

    if (user.role !== UserRole.Cliente) {
      throw new DomainException('Apenas clientes podem criar pedidos.');
    }

    const id = randomUUID();
    await this.pedidoRepository.add(id, userId, montarEscopo(request), request.fotos);

    const pedido = await this.pedidos.getById(id, userId);
    if (!pedido) {
      throw new NotFoundException('Pedido', id);
    }

    return pedido;
  }

  // Os limites de página são validados no schema da rota (listarPedidosQuerySchema).
  async list(currentUser: CurrentUser, query: ListarPedidosQuery): Promise<PaginaResponse<PedidoResumoResponse>> {
    return this.pedidos.list(getUserId(currentUser), query.status, query.page, query.pageSize);
  }

  async getById(currentUser: CurrentUser, id: string): Promise<PedidoResponse> {
    const pedido = await this.pedidos.getById(id, getUserId(currentUser));
    if (!pedido) {
      throw new NotFoundException('Pedido', id);
    }

    return pedido;
  }

  async getSummary(currentUser: CurrentUser): Promise<ResumoHomeResponse> {
    return this.pedidos.getSummary(getUserId(currentUser));
  }
}

/**
 * Grava no jsonb pedidos.escopo só as chaves informadas, sem espaços nas pontas.
 */
export function montarEscopo(request: CriarPedidoRequest): string {
  const escopo: Record<string, string> = {};

  const adicionar = (chave: string, valor: string | null | undefined) => {
    if (valor?.trim()) {
      escopo[chave] = valor.trim();
    }
  };

  adicionar('titulo', request.titulo);
  adicionar('categoria', request.categoria);
  adicionar('descricao', request.descricao);
  adicionar('localizacao', request.localizacao);
  adicionar('detalhes', request.detalhes);
  adicionar('urgencia', request.urgencia);
  adicionar('especificacoes', request.especificacoes);

  return JSON.stringify(escopo);
}

function getUserId(currentUser: CurrentUser): string {
  if (currentUser.isAuthenticated && currentUser.id && currentUser.id !== guidVazio) {
    return currentUser.id;
  }

  throw new UnauthorizedException('Token sem identificação de usuário.');
}
