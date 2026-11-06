import { DomainException } from '../../domain/errors.js';
import type { CurrentUser, IUserRepository } from '../contracts.js';
import type { PaginaResponse } from '../dtos/common.js';
import type {
  CriarPropostaPrestador,
  EditarPropostaPrestador,
  ListarPropostasPrestadorQuery,
  PropostaPrestadorResponse,
  ResumoPrestador
} from '../dtos/prestador.js';
import { ConflictException, NotFoundException } from '../errors.js';
import { getUserId } from './prestador-service.js';

export type PaginaPropostasPrestador = PaginaResponse<PropostaPrestadorResponse> & { counts: ResumoPrestador['proposals'] };
export interface FiltroPropostasPrestador {
  status?: 'sent' | 'viewed' | 'chosen' | 'notchosen';
  q?: string;
}

export type ResultadoCriarProposta = PropostaPrestadorResponse | 'notFound' | 'closed' | 'duplicate';
export type ResultadoAlterarProposta = PropostaPrestadorResponse | 'notFound' | 'locked';
export type ResultadoRetirarProposta = 'ok' | 'notFound' | 'locked';

export interface IPropostaPrestadorRepository {
  create(orderId: string, prestadorId: string, input: CriarPropostaPrestador): Promise<ResultadoCriarProposta>;
  list(prestadorId: string, filtro: FiltroPropostasPrestador, page: number, pageSize: number): Promise<PaginaPropostasPrestador>;
  getById(id: string, prestadorId: string): Promise<PropostaPrestadorResponse | null>;
  update(id: string, prestadorId: string, input: EditarPropostaPrestador): Promise<ResultadoAlterarProposta>;
  remove(id: string, prestadorId: string): Promise<ResultadoRetirarProposta>;
}

const mensagemTravada =
  'Esta proposta não pode mais ser alterada ou retirada: ela já foi escolhida, não foi selecionada ou o pedido foi encerrado.';

/**
 * Propostas enviadas pelo prestador (criar, listar, editar e retirar).
 */
export class PropostaPrestadorService {
  constructor(
    private readonly repository: IPropostaPrestadorRepository,
    private readonly users: IUserRepository
  ) {}

  async criar(currentUser: CurrentUser, orderId: string, request: CriarPropostaPrestador): Promise<PropostaPrestadorResponse> {
    const id = getUserId(currentUser);
    const user = await this.users.getById(id);
    if (!user?.cpf?.trim()) {
      throw new DomainException('Finalize o cadastro antes de enviar uma proposta.');
    }

    const resultado = await this.repository.create(orderId, id, request);
    switch (resultado) {
      case 'notFound':
        throw new NotFoundException('Pedido', orderId);
      case 'closed':
        throw new ConflictException('Este pedido não recebe mais propostas.');
      case 'duplicate':
        throw new ConflictException('Você já enviou uma proposta para este pedido. Edite a proposta existente.');
      default:
        return resultado;
    }
  }

  listar(currentUser: CurrentUser, query: ListarPropostasPrestadorQuery): Promise<PaginaPropostasPrestador> {
    return this.repository.list(getUserId(currentUser), { status: query.status, q: query.q?.trim() || undefined }, query.page, query.pageSize);
  }

  async obter(currentUser: CurrentUser, id: string): Promise<PropostaPrestadorResponse> {
    const proposta = await this.repository.getById(id, getUserId(currentUser));
    if (!proposta) {
      throw new NotFoundException('Proposta', id);
    }

    return proposta;
  }

  async editar(currentUser: CurrentUser, id: string, request: EditarPropostaPrestador): Promise<PropostaPrestadorResponse> {
    const resultado = await this.repository.update(id, getUserId(currentUser), request);
    if (resultado === 'notFound') throw new NotFoundException('Proposta', id);
    if (resultado === 'locked') throw new ConflictException(mensagemTravada);
    return resultado;
  }

  async retirar(currentUser: CurrentUser, id: string): Promise<void> {
    const resultado = await this.repository.remove(id, getUserId(currentUser));
    if (resultado === 'notFound') throw new NotFoundException('Proposta', id);
    if (resultado === 'locked') throw new ConflictException(mensagemTravada);
  }
}
