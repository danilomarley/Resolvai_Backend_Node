import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  criarPedidoRequestSchema,
  listarPedidosQuerySchema,
  paginaPedidosResponseSchema,
  pedidoIdParamsSchema,
  pedidoResponseSchema
} from '../../application/dtos/pedidos.js';
import { assistenteRequestSchema, assistenteResponseSchema } from '../../application/dtos/assistente.js';
import { fotoEnviadaResponseSchema } from '../../application/dtos/fotos.js';
import type { AssistentePedidoService } from '../../application/services/assistente-pedido-service.js';
import type { FotoPedidoService } from '../../application/services/foto-pedido-service.js';
import type { PedidoService } from '../../application/services/pedido-service.js';
import { DomainException } from '../../domain/errors.js';
import { LimitadorDeTentativas } from '../limitador.js';
import { guidDaRota, semCache, urlAbsoluta } from './util.js';

/**
 * Rotas de pedidos (equivalente ao PedidosController, em /api/v1/orders).
 */
export function pedidosRoutes(
  pedidoService: PedidoService,
  fotoPedidoService: FotoPedidoService,
  assistentePedidoService: AssistentePedidoService
) {
  // Cada mensagem do chat gera uma chamada paga à API do Claude.
  const limiteDoAssistente = new LimitadorDeTentativas(30, 10 * 60 * 1000);
  const limiteDeFotos = new LimitadorDeTentativas(20, 10 * 60 * 1000);

  return async (app: FastifyInstance) => {
    const rotas = app.withTypeProvider<ZodTypeProvider>();

    rotas.post('/api/v1/orders/photos', {
      schema: {
        tags: ['Pedidos'],
        summary: 'Envia uma foto para anexar ao pedido (#67).',
        description:
          'multipart/form-data com o arquivo no campo "foto" (JPG, PNG ou WEBP, até 5 MB). Exige cadastro finalizado. Devolve a URL para usar em fotos[].url de POST /api/v1/orders.',
        consumes: ['multipart/form-data'],
        response: { 201: fotoEnviadaResponseSchema }
      },
      handler: async (request, reply) => {
        semCache(reply);
        limiteDeFotos.registrar(`foto:${request.usuario.id}`, 'Muitas fotos enviadas em pouco tempo. Aguarde alguns minutos.');

        try {
          const arquivo = await request.file();
          if (!arquivo) {
            throw new DomainException('Envie a foto no campo "foto".');
          }

          const conteudo = await arquivo.toBuffer();
          const enviada = await fotoPedidoService.enviar(request.usuario, { conteudo, contentType: arquivo.mimetype });
          return reply.code(201).send(enviada);
        } catch (error) {
          const codigo = (error as { code?: string }).code;
          if (codigo === 'FST_REQ_FILE_TOO_LARGE') {
            throw new DomainException('A foto deve ter no máximo 5 MB.');
          }
          if (codigo === 'FST_INVALID_MULTIPART_CONTENT_TYPE') {
            throw new DomainException('Envie a foto como multipart/form-data no campo "foto".');
          }
          throw error;
        }
      }
    });

    rotas.post('/api/v1/orders/assistant', {
      schema: {
        tags: ['Pedidos'],
        summary: 'Chat com IA para montar o pedido (#69).',
        description:
          'Envie a conversa completa (a API não guarda histórico). A resposta traz a próxima mensagem do assistente e o escopo sugerido, com as mesmas chaves do corpo de POST /api/v1/orders.',
        body: assistenteRequestSchema,
        response: { 200: assistenteResponseSchema }
      },
      handler: (request, reply) => {
        semCache(reply);
        limiteDoAssistente.registrar(
          `chat:${request.usuario.id}`,
          'Muitas mensagens em pouco tempo. Aguarde alguns minutos e tente novamente.'
        );
        return assistentePedidoService.conversar(request.usuario, request.body);
      }
    });

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
