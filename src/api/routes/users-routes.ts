import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  completeRegistrationRequestSchema,
  createUserRequestSchema,
  setUserStatusRequestSchema,
  userResponseSchema
} from '../../application/dtos/users.js';
import type { UserService } from '../../application/services/user-service.js';
import { exigirAdmin } from '../authentication.js';
import { guidDaRota, urlAbsoluta } from './util.js';

const idParams = z.object({ id: z.string() });

export function usersRoutes(userService: UserService) {
  return async (app: FastifyInstance) => {
    const rotas = app.withTypeProvider<ZodTypeProvider>();

    rotas.get('/api/v1/users/me', {
      schema: {
        tags: ['Users'],
        summary: 'Dados do usuário dono do token informado.',
        response: { 200: userResponseSchema }
      },
      handler: request => userService.getCurrent(request.usuario)
    });

    rotas.get('/api/v1/users', {
      preHandler: exigirAdmin,
      schema: {
        tags: ['Users'],
        summary: 'Lista todos os usuários (somente Admin).',
        response: { 200: z.array(userResponseSchema) }
      },
      handler: () => userService.getAll()
    });

    rotas.get('/api/v1/users/:id', {
      preHandler: exigirAdmin,
      schema: {
        tags: ['Users'],
        summary: 'Consulta um usuário pelo id (somente Admin).',
        params: idParams,
        response: { 200: userResponseSchema }
      },
      handler: async (request, reply) => {
        const id = guidDaRota(request, reply);
        return id ? userService.getById(id) : reply;
      }
    });

    rotas.post('/api/v1/users', {
      preHandler: exigirAdmin,
      schema: {
        tags: ['Users'],
        summary: 'Criação administrativa, única forma de nascer com papel diferente de Cliente.',
        body: createUserRequestSchema,
        response: { 201: userResponseSchema }
      },
      handler: async (request, reply) => {
        const user = await userService.create(request.body);
        return reply.code(201).header('Location', urlAbsoluta(request, `/api/v1/users/${user.id}`)).send(user);
      }
    });

    rotas.patch('/api/v1/users/:id/status', {
      preHandler: exigirAdmin,
      schema: {
        tags: ['Users'],
        summary: 'Ativa ou desativa um usuário (somente Admin).',
        params: idParams,
        body: setUserStatusRequestSchema,
        response: { 200: userResponseSchema }
      },
      handler: async (request, reply) => {
        const id = guidDaRota(request, reply);
        return id ? userService.setActive(id, request.body.isActive) : reply;
      }
    });

    rotas.post('/api/v1/users/me/complete-registration', {
      schema: {
        tags: ['Users'],
        summary: 'Finaliza o cadastro do usuário dono do token (CPF, endereço e contato).',
        body: completeRegistrationRequestSchema,
        response: { 200: userResponseSchema }
      },
      handler: request => userService.completeRegistration(request.usuario, request.body)
    });
  };
}
