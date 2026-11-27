import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { assinarContratoRequestSchema, contratoResponseSchema } from '../../application/dtos/contratos.js';
import { pedidoIdParamsSchema } from '../../application/dtos/pedidos.js';
import type { ContratoService } from '../../application/services/contrato-service.js';
import { exigirPrestador } from '../authentication.js';
import { guidDaRota, semCache } from './util.js';

/**
 * Contrato de prestação de serviços (Resolvai_Cliente#95). O contratante usa /orders/{id}/contract e o
 * prestador, /provider/proposals/{id}/contract. Quem não é parte do contrato recebe 404.
 */
export function contratosRoutes(service: ContratoService) {
  return async (app: FastifyInstance) => {
    const rotas = app.withTypeProvider<ZodTypeProvider>();
    const protegido = { preHandler: exigirPrestador };

    rotas.get('/api/v1/orders/:id/contract', {
      schema: {
        tags: ['Contratos'],
        summary: 'Contrato do pedido do usuário autenticado (contratante).',
        description:
          'O contrato nasce quando o contratante aceita uma proposta. Retorna 404 quando o pedido não existe, é de outro usuário ou ainda não tem proposta aceita.',
        params: pedidoIdParamsSchema,
        response: { 200: contratoResponseSchema }
      },
      handler: async (request, reply) => {
        const id = guidDaRota(request, reply);
        if (!id) return reply;
        semCache(reply);
        return service.obterDoCliente(request.usuario, id);
      }
    });

    rotas.post('/api/v1/orders/:id/contract/sign', {
      schema: {
        tags: ['Contratos'],
        summary: 'Assina o contrato como contratante.',
        description:
          'Envie o textHash do contrato lido. Registra data e IP. 409 se já assinou ou se o texto mudou desde a leitura. ' +
          'Quando o prestador também assinou, o contrato passa para Signed.',
        params: pedidoIdParamsSchema,
        body: assinarContratoRequestSchema,
        response: { 200: contratoResponseSchema }
      },
      handler: async (request, reply) => {
        const id = guidDaRota(request, reply);
        if (!id) return reply;
        semCache(reply);
        return service.assinarComoCliente(request.usuario, id, request.body.textHash, request.ip || null);
      }
    });

    rotas.get('/api/v1/provider/proposals/:id/contract', {
      ...protegido,
      schema: {
        tags: ['Contratos'],
        summary: 'Contrato da minha proposta escolhida (prestador).',
        description: 'Retorna 404 quando a proposta não é minha ou ainda não foi escolhida.',
        params: pedidoIdParamsSchema,
        response: { 200: contratoResponseSchema }
      },
      handler: async (request, reply) => {
        const id = guidDaRota(request, reply);
        if (!id) return reply;
        semCache(reply);
        return service.obterDoPrestador(request.usuario, id);
      }
    });

    rotas.post('/api/v1/provider/proposals/:id/contract/sign', {
      ...protegido,
      schema: {
        tags: ['Contratos'],
        summary: 'Assina o contrato como prestador.',
        description: 'Mesmas regras da assinatura do contratante: textHash do texto lido, data e IP registrados, 409 se já assinou ou se o texto mudou.',
        params: pedidoIdParamsSchema,
        body: assinarContratoRequestSchema,
        response: { 200: contratoResponseSchema }
      },
      handler: async (request, reply) => {
        const id = guidDaRota(request, reply);
        if (!id) return reply;
        semCache(reply);
        return service.assinarComoPrestador(request.usuario, id, request.body.textHash, request.ip || null);
      }
    });
  };
}
