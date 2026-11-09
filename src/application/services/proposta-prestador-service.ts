import type { CurrentUser } from '../contracts.js';
import { DomainException } from '../../domain/errors.js';
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
import type { FornecedorService } from './fornecedor-service.js';
import type { ArmazenamentoPortfolio } from './proposta-fornecedor-service.js';

export type PaginaPropostasPrestador = PaginaResponse<PropostaPrestadorResponse> & { counts: ResumoPrestador['proposals'] };
export interface FiltroPropostasPrestador {
  status?: 'sent' | 'viewed' | 'chosen' | 'notchosen';
  q?: string;
}

export type ResultadoCriarProposta = PropostaPrestadorResponse | 'notFound' | 'closed' | 'duplicate' | 'incomplete';
export type ResultadoAlterarProposta = PropostaPrestadorResponse | 'notFound' | 'locked';
export type ResultadoRetirarProposta = 'ok' | 'notFound' | 'locked' | { caminhosPortfolio: string[] };

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
    private readonly fornecedores: Pick<FornecedorService, 'getCurrent'>,
    private readonly storage?: Pick<ArmazenamentoPortfolio, 'remover'>
  ) {}

  async criar(currentUser: CurrentUser, orderId: string, request: CriarPropostaPrestador): Promise<PropostaPrestadorResponse> {
    const id = getUserId(currentUser);
    try {
      await this.fornecedores.getCurrent(currentUser);
    } catch (error) {
      // Legacy providers have CPF and profile tables but no fornecedores row.
      // Their registration and compatibility are checked inside repository.create's transaction.
      if (!(error instanceof NotFoundException)) throw error;
    }

    const resultado = await this.repository.create(orderId, id, request);
    switch (resultado) {
      case 'incomplete':
        throw new DomainException('Finalize o cadastro antes de enviar uma proposta.');
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
    // The repository returns these paths only after the deletion transaction committed.
    // A storage failure retains unused files for later cleanup rather than deleting live photos.
    if (typeof resultado === 'object' && resultado.caminhosPortfolio.length) {
      await this.storage?.remover(resultado.caminhosPortfolio).catch(() => {});
    }
  }
}
