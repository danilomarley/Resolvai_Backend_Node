import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  criarPedidoRequestSchema,
  listarPedidosQuerySchema,
  paginaPedidosResponseSchema,
  pedidoIdParamsSchema,
  pedidoResponseSchema
} from '../../application/dtos/pedidos.js';
import type { PedidoService } from '../../application/services/pedido-service.js';
import { guidDaRota, semCache, urlAbsoluta } from './util.js';

/**
 * Rotas de pedidos (equivalente ao PedidosController, em /api/v1/orders).
 */
export function pedidosRoutes(pedidoService: PedidoService) {
  return async (app: FastifyInstance) => {
    const rotas = app.withTypeProvider<ZodTypeProvider>();

    rotas.get('/api/v1/orders', {
      schema: {
        tags: ['Pedidos'],
        summary: 'Lista paginada dos pedidos do usuário autenticado (Seus Pedidos).',
        description:
          'Ordenada por data de criação decrescente. Filtro opcional por status. page a partir de 1 e pageSize entre 1 e 50 (padrão 10).',
        querystring: listarPedidosQuerySchema,
        response: { 200: paginaPedidosResponseSchema }
      },
      handler: (request, reply) => {
        semCache(reply);
        return pedidoService.list(request.usuario, request.query);
      }
    });

    rotas.post('/api/v1/orders', {
      schema: {
        tags: ['Pedidos'],
        summary: 'Cria um pedido para o cliente autenticado.',
        description:
          'Exige cadastro finalizado. O pedido nasce com status Pending. As fotos devem ser enviadas como URLs já hospedadas (até 4).',
        body: criarPedidoRequestSchema,
        response: { 201: pedidoResponseSchema }
      },
      handler: async (request, reply) => {
        semCache(reply);
        const pedido = await pedidoService.criar(request.usuario, request.body);
        return reply.code(201).header('Location', urlAbsoluta(request, `/api/v1/orders/${pedido.id}`)).send(pedido);
      }
    });

    rotas.get('/api/v1/orders/:id', {
      schema: {
        tags: ['Pedidos'],
        summary: 'Consulta os detalhes de um pedido do usuário autenticado.',
        description:
          'Inclui escopo, fotos e propostas recebidas. Retorna 404 quando o pedido não existe ou pertence a outro usuário.',
        params: pedidoIdParamsSchema,
        response: { 200: pedidoResponseSchema }
      },
      handler: async (request, reply) => {
        const id = guidDaRota(request, reply);
        if (!id) return reply;
        semCache(reply);
        return pedidoService.getById(request.usuario, id);
      }
    });
  };
}
