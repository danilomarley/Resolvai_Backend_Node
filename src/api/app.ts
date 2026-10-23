import fastifyCors from '@fastify/cors';
import fastifyMultipart from '@fastify/multipart';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance, type FastifyServerOptions, LogController } from 'fastify';
import { jsonSchemaTransform, serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { type CurrentUser, type IUserRepository, usuarioAnonimo } from '../application/contracts.js';
import type { AssistentePedidoService } from '../application/services/assistente-pedido-service.js';
import type { AuthService } from '../application/services/auth-service.js';
import { type FotoPedidoService, tamanhoMaximoFoto } from '../application/services/foto-pedido-service.js';
import type { PedidoService } from '../application/services/pedido-service.js';
import type { UserService } from '../application/services/user-service.js';
import { criarHookDeAutenticacao, type VerificarToken } from './authentication.js';
import { gerarTraceId, registrarTratamentoDeErros } from './problem-details.js';
import { authRoutes } from './routes/auth-routes.js';
import { homeRoutes } from './routes/home-routes.js';
import { pedidosRoutes } from './routes/pedidos-routes.js';
import { usersRoutes } from './routes/users-routes.js';

export interface Dependencias {
  authService: AuthService;
  userService: UserService;
  pedidoService: PedidoService;
  fotoPedidoService: FotoPedidoService;
  assistentePedidoService: AssistentePedidoService;
  /** Usado pela autenticação para aplicar papel e situação do perfil local. */
  userRepository: IUserRepository;
  verificarToken: VerificarToken;
}

export interface AppOptions {
  dependencias: Dependencias;
  corsAllowedOrigins?: string[];
  logger?: FastifyServerOptions['logger'];
}

const esquemaBearer = 'Bearer';

export async function buildApp({ dependencias, corsAllowedOrigins = [], logger = false }: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger,
    genReqId: gerarTraceId,
    logController: new LogController({ requestIdLogLabel: 'traceId' }),
    // Atrás do proxy do provedor de deploy, para Location e logs usarem o host/protocolo públicos.
    trustProxy: true
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorateRequest('usuario', null as unknown as CurrentUser);
  app.addHook('onRequest', async request => {
    request.usuario = usuarioAnonimo;
  });
  registrarTratamentoDeErros(app);

  // Sem origens configuradas, nenhuma origem externa é liberada (mesma regra da API C#).
  if (corsAllowedOrigins.length > 0) {
    await app.register(fastifyCors, {
      origin: corsAllowedOrigins,
      methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
    });
  }

  await app.register(fastifySwagger, {
    openapi: {
      openapi: '3.1.0',
      info: { title: 'Resolvai.Api', version: 'v1' },
      components: {
        securitySchemes: {
          [esquemaBearer]: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'Access token JWT do Supabase Auth (POST /api/v1/auth/login ou client SDK).'
          }
        }
      }
    },
    transform: jsonSchemaTransform
  });

  await app.register(fastifySwaggerUi, {
    routePrefix: '/swagger',
    uiConfig: { url: '/openapi/v1.json' }
  });

  app.get('/openapi/v1.json', { schema: { hide: true } }, async () => app.swagger());

  // Usado pelo health check do Render: só confirma que o processo está de pé.
  app.get('/health', { schema: { hide: true } }, async () => ({ status: 'ok' }));

  // Uma foto por requisição, até 5 MB (POST /api/v1/orders/photos).
  await app.register(fastifyMultipart, { limits: { fileSize: tamanhoMaximoFoto, files: 1, fields: 5, parts: 6 } });

  await app.register(authRoutes(dependencias.authService));

  // Protegido por padrão: tudo registrado aqui exige Bearer token válido.
  await app.register(async protegido => {
    protegido.addHook('onRoute', rota => {
      rota.schema = { ...rota.schema, security: [{ [esquemaBearer]: [] }] };
    });
    protegido.addHook('onRequest', criarHookDeAutenticacao(dependencias.verificarToken, dependencias.userRepository));

    await protegido.register(usersRoutes(dependencias.userService));
    await protegido.register(pedidosRoutes(dependencias.pedidoService, dependencias.fotoPedidoService, dependencias.assistentePedidoService));
    await protegido.register(homeRoutes(dependencias.pedidoService));
  });

  return app;
}
