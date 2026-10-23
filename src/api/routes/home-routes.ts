import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { resumoHomeResponseSchema } from '../../application/dtos/home.js';
import type { PedidoService } from '../../application/services/pedido-service.js';
import { semCache } from './util.js';

export function homeRoutes(pedidoService: PedidoService) {
  return async (app: FastifyInstance) => {
    const rotas = app.withTypeProvider<ZodTypeProvider>();

    rotas.get('/api/v1/home/summary', {
      schema: {
        tags: ['Home'],
        summary: 'Resumo dos pedidos do usuário autenticado para a Home.',
        description:
          'Dados dos cards (totais por status, ativos, novos em 7 dias e propostas) e até 5 pedidos mais recentes por data de criação. Sem pedidos, retorna contadores zerados e lista vazia.',
        response: { 200: resumoHomeResponseSchema }
      },
      handler: (request, reply) => {
        semCache(reply);
        return pedidoService.getSummary(request.usuario);
      }
    });
  };
}
