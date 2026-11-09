import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { avaliacaoSchema, criarAvaliacaoSchema, resumoAvaliacoesSchema } from '../../application/dtos/avaliacoes.js';
import { pedidoIdParamsSchema } from '../../application/dtos/pedidos.js';
import type { AvaliacaoService } from '../../application/services/avaliacao-service.js';
import { guidDaRota, semCache } from './util.js';

export function avaliacoesRoutes(service: AvaliacaoService) {
  return async (app: FastifyInstance) => {
    const routes = app.withTypeProvider<ZodTypeProvider>();
    routes.post('/api/v1/orders/:id/review', {
      schema: { tags: ['Avaliações'], summary: 'Avalia o prestador do pedido concluído uma única vez.',
        description: 'Exige cliente proprietário, pedido concluído e uma única proposta escolhida. 400: nota/status inválido; 401: sem sessão; 404: pedido inexistente ou de outro cliente; 409: avaliação duplicada ou prestador indefinido.',
        params: pedidoIdParamsSchema, body: criarAvaliacaoSchema, response: { 201: avaliacaoSchema } },
      handler: async (request, reply) => {
        const id = guidDaRota(request, reply);
        if (!id) return reply;
        semCache(reply);
        return reply.code(201).header('Location', `/api/v1/orders/${id}/review`).send(await service.criar(request.usuario, id, request.body));
      }
    });
    routes.get('/api/v1/orders/:id/review', {
      schema: { tags: ['Avaliações'], summary: 'Consulta a avaliação do próprio pedido; null quando ainda não avaliado.', params: pedidoIdParamsSchema, response: { 200: avaliacaoSchema.nullable() } },
      handler: async (request, reply) => {
        const id = guidDaRota(request, reply);
        if (!id) return reply;
        semCache(reply);
        return service.consultar(request.usuario, id);
      }
    });
    routes.get('/api/v1/users/me/reviews/summary', {
      schema: { tags: ['Avaliações'], summary: 'Quantidade e média das notas enviadas pelo cliente autenticado.', response: { 200: resumoAvaliacoesSchema } },
      handler: (request, reply) => { semCache(reply); return service.resumo(request.usuario); }
    });
  };
}
