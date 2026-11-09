import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { pedidoIdParamsSchema } from '../../application/dtos/pedidos.js';
import {
  atualizarPerfilPrestadorSchema,
  categoriaServicoSchema,
  criarPropostaPrestadorSchema,
  editarPropostaPrestadorSchema,
  listarFeedQuerySchema,
  listarPropostasPrestadorQuerySchema,
  paginaFeedResponseSchema,
  paginaPropostasPrestadorResponseSchema,
  pedidoPrestadorResponseSchema,
  perfilPrestadorResponseSchema,
  propostaPrestadorResponseSchema,
  resumoPrestadorResponseSchema
} from '../../application/dtos/prestador.js';
import type { PrestadorService } from '../../application/services/prestador-service.js';
import type { PropostaPrestadorService } from '../../application/services/proposta-prestador-service.js';
import { exigirPrestador } from '../authentication.js';
import { guidDaRota, semCache, urlAbsoluta } from './util.js';

const tag = ['Prestador'];

/**
 * Rotas do app do prestador (/api/v1/provider). Todas exigem o papel Prestador (403 para os demais).
 * O catálogo de categorias fica em /api/v1/catalog e serve a qualquer usuário autenticado.
 */
export function prestadorRoutes(prestadorService: PrestadorService, propostaService: PropostaPrestadorService) {
  return async (app: FastifyInstance) => {
    const rotas = app.withTypeProvider<ZodTypeProvider>();
    const protegido = { preHandler: exigirPrestador };

    rotas.get('/api/v1/catalog/categories', {
      schema: {
        tags: ['Prestador'],
        summary: 'Catálogo baseado nas especialidades ativas; id é o código da especialidade.',
        response: { 200: z.array(categoriaServicoSchema) }
      },
      handler: (_request, reply) => {
        semCache(reply);
        return prestadorService.listarCategorias();
      }
    });

    rotas.get('/api/v1/provider/profile', {
      ...protegido,
      schema: {
        tags: tag,
        summary: 'Perfil profissional: especialidades, cidade principal e situação do cadastro.',
        response: { 200: perfilPrestadorResponseSchema }
      },
      handler: (request, reply) => {
        semCache(reply);
        return prestadorService.perfil(request.usuario);
      }
    });

    rotas.put('/api/v1/provider/profile', {
      ...protegido,
      schema: {
        tags: tag,
        summary: 'Define as especialidades e a cidade principal de atuação.',
        description: 'categoryIds recebe códigos do catálogo, como eletrica; cities contém exatamente uma cidade. Exige perfil profissional em fornecedores.',
        body: atualizarPerfilPrestadorSchema,
        response: { 200: perfilPrestadorResponseSchema }
      },
      handler: (request, reply) => {
        semCache(reply);
        return prestadorService.atualizarPerfil(request.usuario, request.body);
      }
    });

    rotas.get('/api/v1/provider/summary', {
      ...protegido,
      schema: {
        tags: tag,
        summary: 'Indicadores da Home do prestador.',
        response: { 200: resumoPrestadorResponseSchema }
      },
      handler: (request, reply) => {
        semCache(reply);
        return prestadorService.resumo(request.usuario);
      }
    });

    rotas.get('/api/v1/provider/orders', {
      ...protegido,
      schema: {
        tags: tag,
        summary: 'Feed de pedidos abertos (sem proposta escolhida).',
        description:
          'Compatíveis primeiro, depois os mais recentes. O contratante aparece só pelo primeiro nome. Filtros: category (slug), city, urgency, q e compatible=true.',
        querystring: listarFeedQuerySchema,
        response: { 200: paginaFeedResponseSchema }
      },
      handler: (request, reply) => {
        semCache(reply);
        return prestadorService.feed(request.usuario, request.query);
      }
    });

    rotas.get('/api/v1/provider/orders/:id', {
      ...protegido,
      schema: {
        tags: tag,
        summary: 'Detalhe de um pedido para o prestador.',
        description: 'Visível enquanto o pedido está aberto, ou depois, para o prestador que enviou proposta. 404 nos demais casos.',
        params: pedidoIdParamsSchema,
        response: { 200: pedidoPrestadorResponseSchema }
      },
      handler: async (request, reply) => {
        const id = guidDaRota(request, reply);
        if (!id) return reply;
        semCache(reply);
        return prestadorService.pedido(request.usuario, id);
      }
    });

    rotas.post('/api/v1/provider/orders/:id/proposals', {
      ...protegido,
      schema: {
        tags: tag,
        summary: 'Envia uma proposta para o pedido.',
        description:
          'value (R$), deadlineDays (1 a 365), description e warranty (obrigatória). Exige cadastro finalizado. 409 quando o pedido não está mais aberto ou o prestador já propôs.',
        params: pedidoIdParamsSchema,
        body: criarPropostaPrestadorSchema,
        response: { 201: propostaPrestadorResponseSchema }
      },
      handler: async (request, reply) => {
        const id = guidDaRota(request, reply);
        if (!id) return reply;
        semCache(reply);
        const proposta = await propostaService.criar(request.usuario, id, request.body);
        return reply.code(201).header('Location', urlAbsoluta(request, `/api/v1/provider/proposals/${proposta.id}`)).send(proposta);
      }
    });

    rotas.get('/api/v1/provider/proposals', {
      ...protegido,
      schema: {
        tags: tag,
        summary: 'Minhas propostas, com totais por status.',
        querystring: listarPropostasPrestadorQuerySchema,
        response: { 200: paginaPropostasPrestadorResponseSchema }
      },
      handler: (request, reply) => {
        semCache(reply);
        return propostaService.listar(request.usuario, request.query);
      }
    });

    rotas.get('/api/v1/provider/proposals/:id', {
      ...protegido,
      schema: { tags: tag, summary: 'Detalhe de uma proposta minha.', params: pedidoIdParamsSchema, response: { 200: propostaPrestadorResponseSchema } },
      handler: async (request, reply) => {
        const id = guidDaRota(request, reply);
        if (!id) return reply;
        semCache(reply);
        return propostaService.obter(request.usuario, id);
      }
    });

    rotas.patch('/api/v1/provider/proposals/:id', {
      ...protegido,
      schema: {
        tags: tag,
        summary: 'Edita uma proposta ainda não decidida.',
        description: 'Só propostas Sent ou Viewed em pedido aberto. 409 caso contrário.',
        params: pedidoIdParamsSchema,
        body: editarPropostaPrestadorSchema,
        response: { 200: propostaPrestadorResponseSchema }
      },
      handler: async (request, reply) => {
        const id = guidDaRota(request, reply);
        if (!id) return reply;
        semCache(reply);
        return propostaService.editar(request.usuario, id, request.body);
      }
    });

    rotas.delete('/api/v1/provider/proposals/:id', {
      ...protegido,
      schema: {
        tags: tag,
        summary: 'Retira uma proposta ainda não decidida.',
        description: 'Remove a proposta; o prestador pode propor de novo enquanto o pedido estiver aberto. 409 se já foi escolhida ou o pedido foi encerrado.',
        params: pedidoIdParamsSchema
      },
      handler: async (request, reply) => {
        const id = guidDaRota(request, reply);
        if (!id) return reply;
        semCache(reply);
        await propostaService.retirar(request.usuario, id);
        return reply.code(204).send();
      }
    });
  };
}
