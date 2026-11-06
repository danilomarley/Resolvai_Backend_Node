import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { listaPropostasResponseSchema, listarPropostasQuerySchema, propostaDetalheResponseSchema } from '../../application/dtos/propostas.js';
import { pedidoIdParamsSchema } from '../../application/dtos/pedidos.js';
import type { PropostaService } from '../../application/services/proposta-service.js';
import { normalizarGuid } from '../guid.js';
import { guidDaRota, semCache } from './util.js';

const propostaParamsSchema = pedidoIdParamsSchema.extend({ proposalId: z.string() });

/**
 * Propostas recebidas por um pedido (#83), em /api/v1/orders/{id}/proposals.
 */
export function propostasRoutes(service: PropostaService) {
  return async (app: FastifyInstance) => {
    const rotas = app.withTypeProvider<ZodTypeProvider>();

    rotas.get('/api/v1/orders/:id/proposals', {
      schema: {
        tags: ['Propostas'],
        summary: 'Lista as propostas recebidas pelo pedido do usuário autenticado.',
        description:
          'Cada item traz prestador, valor, prazo, garantia, descrição, data de envio e a avaliação média do prestador. ' +
          'sort=price (padrão), deadline ou rating; direction=asc ou desc (padrão: asc em price e deadline, desc em rating). ' +
          'Propostas sem prazo numérico ou de prestadores sem avaliação ficam por último. ' +
          'Retorna 404 quando o pedido não existe ou pertence a outro usuário.',
        params: pedidoIdParamsSchema,
        querystring: listarPropostasQuerySchema,
        response: { 200: listaPropostasResponseSchema }
      },
      handler: async (request, reply) => {
        const id = guidDaRota(request, reply);
        if (!id) return reply;
        semCache(reply);
        return service.list(request.usuario, id, request.query);
      }
    });

    rotas.get('/api/v1/orders/:id/proposals/:proposalId', {
      schema: {
        tags: ['Propostas'],
        summary: 'Detalhe de uma proposta, com o resumo do prestador.',
        description:
          'Inclui desde quando o prestador é membro e quantos serviços concluiu. ' +
          'Abrir o detalhe marca a proposta como visualizada (Sent → Viewed). ' +
          'Retorna 404 quando a proposta não existe, não é do pedido ou o pedido pertence a outro usuário.',
        params: propostaParamsSchema,
        response: { 200: propostaDetalheResponseSchema }
      },
      handler: async (request, reply) => {
        const orderId = normalizarGuid(request.params.id);
        const proposalId = normalizarGuid(request.params.proposalId);
        if (!orderId || !proposalId) {
          return reply.callNotFound();
        }

        semCache(reply);
        return service.getById(request.usuario, orderId, proposalId);
      }
    });
  };
}
