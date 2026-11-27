import { randomUUID } from 'node:crypto';
import { UserRole } from '../../domain/enums.js';
import { DomainException } from '../../domain/errors.js';
import type { CurrentUser, IPedidoQueries, IPedidoRepository, IUserRepository, ResultadoAlteracaoPedido } from '../contracts.js';
import type { PaginaResponse } from '../dtos/common.js';
import type { ResumoHomeResponse } from '../dtos/home.js';
import type {
  CancelarPedidoRequest,
  CriarPedidoRequest,
  EditarPedidoRequest,
  ListarPedidosQuery,
  PedidoResponse,
  PedidoResumoResponse
} from '../dtos/pedidos.js';
import { ConflictException, NotFoundException, UnauthorizedException } from '../errors.js';

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

  /** Edita um pedido ainda sem proposta aceita (#85). Só o dono altera; outro usuário recebe 404. */
  async editar(currentUser: CurrentUser, id: string, request: EditarPedidoRequest): Promise<PedidoResponse> {
    const userId = getUserId(currentUser);
    recusarSeNaoAlterou(await this.pedidoRepository.update(id, userId, montarEscopo(request), request.fotos), id, 'alterado');
    return this.getById(currentUser, id);
  }

  /** Cancela um pedido ainda sem proposta aceita, com motivo opcional (#85). */
  async cancelar(currentUser: CurrentUser, id: string, request: CancelarPedidoRequest): Promise<PedidoResponse> {
    const userId = getUserId(currentUser);
    const motivo = request.reason?.trim() || null;
    recusarSeNaoAlterou(await this.pedidoRepository.cancel(id, userId, motivo), id, 'cancelado');
    return this.getById(currentUser, id);
  }

  /** O contratante confirma a conclusao do servico; so vale para pedido em andamento, ou seja, ja pago (#92). */
  async concluir(currentUser: CurrentUser, id: string): Promise<PedidoResponse> {
    const resultado = await this.pedidoRepository.complete(id, getUserId(currentUser));
    if (resultado === 'notFound') {
      throw new NotFoundException('Pedido', id);
    }

    if (resultado !== 'ok') {
      throw new ConflictException('Só é possível concluir um pedido em andamento, com o pagamento confirmado.');
    }

    return this.getById(currentUser, id);
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

function recusarSeNaoAlterou(resultado: ResultadoAlteracaoPedido, id: string, acao: 'alterado' | 'cancelado'): void {
  switch (resultado) {
    case 'notFound':
      throw new NotFoundException('Pedido', id);
    case 'closed':
      throw new ConflictException(`Este pedido não pode mais ser ${acao}: ele já foi cancelado, concluído ou está em andamento.`);
    case 'proposalChosen':
      throw new ConflictException(`Este pedido não pode mais ser ${acao}: uma proposta já foi aceita.`);
    default:
  }
}

function getUserId(currentUser: CurrentUser): string {
  if (currentUser.isAuthenticated && currentUser.id && currentUser.id !== guidVazio) {
    return currentUser.id;
  }

  throw new UnauthorizedException('Token sem identificação de usuário.');
}
