import type { CurrentUser } from '../contracts.js';
import type { ContratoResponse } from '../dtos/contratos.js';
import { ConflictException, NotFoundException, UnauthorizedException } from '../errors.js';

const guidVazio = '00000000-0000-0000-0000-000000000000';

export type ParteAssinante = 'customer' | 'provider';
export type ResultadoAssinatura = 'ok' | 'notFound' | 'alreadySigned' | 'hashMismatch';

export interface IContratoRepository {
  /** null quando o pedido não é do cliente ou ainda não tem proposta aceita. */
  getForCustomer(orderId: string, customerId: string): Promise<ContratoResponse | null>;
  /** null quando a proposta não é do prestador ou não foi escolhida. */
  getForProvider(proposalId: string, providerId: string): Promise<ContratoResponse | null>;
  /** Registra a assinatura da parte; a parte é identificada pelo usuário, que precisa ser dela no contrato. */
  sign(contractId: string, parte: ParteAssinante, userId: string, textHash: string, ip: string | null): Promise<ResultadoAssinatura>;
}

/**
 * Contrato de prestação de serviços (#95): leitura e assinatura pelo contratante e pelo prestador.
 * Quando as duas partes assinam, o contrato fica Signed e o pagamento pode começar.
 */
export class ContratoService {
  constructor(private readonly repository: IContratoRepository) {}

  async obterDoCliente(currentUser: CurrentUser, orderId: string): Promise<ContratoResponse> {
    const contrato = await this.repository.getForCustomer(orderId, getUserId(currentUser));
    if (!contrato) {
      throw new NotFoundException('Contrato', orderId);
    }

    return contrato;
  }

  async assinarComoCliente(currentUser: CurrentUser, orderId: string, textHash: string, ip: string | null): Promise<ContratoResponse> {
    const userId = getUserId(currentUser);
    const contrato = await this.obterDoCliente(currentUser, orderId);
    recusarSeNaoAssinou(await this.repository.sign(contrato.id, 'customer', userId, textHash, ip), orderId);
    return this.obterDoCliente(currentUser, orderId);
  }

  async obterDoPrestador(currentUser: CurrentUser, proposalId: string): Promise<ContratoResponse> {
    const contrato = await this.repository.getForProvider(proposalId, getUserId(currentUser));
    if (!contrato) {
      throw new NotFoundException('Contrato', proposalId);
    }

    return contrato;
  }

  async assinarComoPrestador(currentUser: CurrentUser, proposalId: string, textHash: string, ip: string | null): Promise<ContratoResponse> {
    const userId = getUserId(currentUser);
    const contrato = await this.obterDoPrestador(currentUser, proposalId);
    recusarSeNaoAssinou(await this.repository.sign(contrato.id, 'provider', userId, textHash, ip), proposalId);
    return this.obterDoPrestador(currentUser, proposalId);
  }
}

function recusarSeNaoAssinou(resultado: ResultadoAssinatura, id: string): void {
  switch (resultado) {
    case 'notFound':
      throw new NotFoundException('Contrato', id);
    case 'alreadySigned':
      throw new ConflictException('Você já assinou este contrato.');
    case 'hashMismatch':
      throw new ConflictException('O texto do contrato não é mais o que você leu. Recarregue a página e leia de novo antes de assinar.');
    default:
  }
}

function getUserId(currentUser: CurrentUser): string {
  if (currentUser.isAuthenticated && currentUser.id && currentUser.id !== guidVazio) {
    return currentUser.id;
  }

  throw new UnauthorizedException('Token sem identificação de usuário.');
}
