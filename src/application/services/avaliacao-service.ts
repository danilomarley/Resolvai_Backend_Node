import type { CurrentUser } from '../contracts.js';
import { criarAvaliacaoSchema, type Avaliacao, type CriarAvaliacao, type ResumoAvaliacoes } from '../dtos/avaliacoes.js';
import { ConflictException, NotFoundException, UnauthorizedException } from '../errors.js';
import { DomainException } from '../../domain/errors.js';

export type ResultadoAvaliacao = Avaliacao | 'notFound' | 'notCompleted' | 'invalidProvider' | 'duplicate';
export interface IAvaliacaoRepository {
  criar(orderId: string, customerId: string, input: CriarAvaliacao): Promise<ResultadoAvaliacao>;
  consultar(orderId: string, customerId: string): Promise<Avaliacao | null | undefined>;
  resumo(customerId: string): Promise<ResumoAvaliacoes>;
}

export class AvaliacaoService {
  constructor(private readonly repository: IAvaliacaoRepository) {}

  async criar(user: CurrentUser, orderId: string, input: CriarAvaliacao): Promise<Avaliacao> {
    const customerId = this.cliente(user);
    const parsed = criarAvaliacaoSchema.safeParse(input);
    if (!parsed.success) throw new DomainException('Informe uma nota inteira de 1 a 5 e comentário de até 2000 caracteres.');
    const result = await this.repository.criar(orderId, customerId, parsed.data);
    switch (result) {
      case 'notFound': throw new NotFoundException('Pedido', orderId);
      case 'notCompleted': throw new DomainException('Somente pedidos concluídos podem ser avaliados.');
      case 'invalidProvider': throw new ConflictException('O pedido precisa ter uma única proposta escolhida para identificar o prestador.');
      case 'duplicate': throw new ConflictException('Este pedido já foi avaliado.');
      default: return result;
    }
  }

  async consultar(user: CurrentUser, orderId: string): Promise<Avaliacao | null> {
    const review = await this.repository.consultar(orderId, this.cliente(user));
    if (review === undefined) throw new NotFoundException('Pedido', orderId);
    return review;
  }

  resumo(user: CurrentUser): Promise<ResumoAvaliacoes> { return this.repository.resumo(this.cliente(user)); }

  private cliente(user: CurrentUser): string {
    if (!user.isAuthenticated || !user.id) throw new UnauthorizedException();
    if (user.role !== 'Cliente') throw new DomainException('Apenas clientes podem avaliar serviços.');
    return user.id;
  }
}
