import type { CurrentUser, IAssistentePedido } from '../contracts.js';
import type { AssistenteRequest, AssistenteResponse } from '../dtos/assistente.js';
import { UnauthorizedException } from '../errors.js';

/**
 * Chat de IA da tela "Criar pedido" (#69): ajuda o cliente a descrever o serviço e devolve o escopo sugerido.
 * O pedido só é criado quando o cliente confirma o formulário (POST /api/v1/orders).
 */
export class AssistentePedidoService {
  constructor(private readonly assistente: IAssistentePedido) {}

  async conversar(currentUser: CurrentUser, request: AssistenteRequest): Promise<AssistenteResponse> {
    if (!currentUser.isAuthenticated || !currentUser.id) {
      throw new UnauthorizedException('Token sem identificação de usuário.');
    }

    const resultado = await this.assistente.responder(request.messages);

    return { reply: resultado.resposta, scope: resultado.escopo, complete: resultado.completo };
  }
}
