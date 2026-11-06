import type { PropostaResponse } from '../dtos/pedidos.js';
import type { DirecaoPropostas, ListarPropostasQuery, OrdenacaoPropostas, PropostaDetalheResponse } from '../dtos/propostas.js';
import { StatusProposta } from '../../domain/enums.js';
import type { CurrentUser } from '../contracts.js';
import { NotFoundException, UnauthorizedException } from '../errors.js';

const guidVazio = '00000000-0000-0000-0000-000000000000';

export interface IPropostaRepository {
  /** null quando o pedido não existe ou não é do cliente. */
  list(orderId: string, customerId: string, sort: OrdenacaoPropostas, direction: DirecaoPropostas): Promise<PropostaResponse[] | null>;
  /** null quando a proposta não existe, não é do pedido ou o pedido não é do cliente. */
  getById(orderId: string, proposalId: string, customerId: string): Promise<PropostaDetalheResponse | null>;
  /** Passa enviada → visualizada. Devolve false quando não havia o que marcar. */
  markViewed(orderId: string, proposalId: string, customerId: string): Promise<boolean>;
}

/**
 * Propostas que os prestadores enviaram para um pedido do cliente (#83).
 */
export class PropostaService {
  constructor(private readonly repository: IPropostaRepository) {}

  async list(currentUser: CurrentUser, orderId: string, query: Partial<ListarPropostasQuery>): Promise<PropostaResponse[]> {
    const sort = query.sort ?? 'price';
    // Preço e prazo: o menor primeiro. Avaliação: a melhor primeiro.
    const direction = query.direction ?? (sort === 'rating' ? 'desc' : 'asc');

    const propostas = await this.repository.list(orderId, getUserId(currentUser), sort, direction);
    if (!propostas) {
      throw new NotFoundException('Pedido', orderId);
    }

    return propostas;
  }

  /**
   * Abrir o detalhe conta como "visualizada" para o contador de propostas a conferir da Home.
   * A listagem não marca nada.
   */
  async getById(currentUser: CurrentUser, orderId: string, proposalId: string): Promise<PropostaDetalheResponse> {
    const userId = getUserId(currentUser);
    const proposta = await this.repository.getById(orderId, proposalId, userId);
    if (!proposta) {
      throw new NotFoundException('Proposta', proposalId);
    }

    if (proposta.status === StatusProposta.Sent && (await this.repository.markViewed(orderId, proposalId, userId))) {
      return { ...proposta, status: StatusProposta.Viewed };
    }

    return proposta;
  }
}

function getUserId(currentUser: CurrentUser): string {
  if (currentUser.isAuthenticated && currentUser.id && currentUser.id !== guidVazio) {
    return currentUser.id;
  }

  throw new UnauthorizedException('Token sem identificação de usuário.');
}
