import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { SignJWT } from 'jose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/api/app.js';
import { criarVerificadorDeToken } from '../src/api/authentication.js';
import { UnauthorizedException } from '../src/application/errors.js';
import { AuthService } from '../src/application/services/auth-service.js';
import { PedidoService } from '../src/application/services/pedido-service.js';
import { UserService } from '../src/application/services/user-service.js';
import { Email } from '../src/domain/email.js';
import { UserRole } from '../src/domain/enums.js';
import { User } from '../src/domain/user.js';
import { FakeContatos, FakeEnderecos, FakePedidoRepository, FakeQueries, FakeSupabase, FakeUsers, pedidoDeTeste } from './fakes.js';

const issuer = 'https://projeto-teste.supabase.co/auth/v1';
const segredo = 'segredo-de-teste-com-tamanho-suficiente-para-hs256';

function token(sub: string, extra: { email?: string; aud?: string; iss?: string; expira?: string; segredo?: string } = {}) {
  return new SignJWT({ email: extra.email ?? 'maria@teste.com', role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(extra.iss ?? issuer)
    .setAudience(extra.aud ?? 'authenticated')
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime(extra.expira ?? '5m')
    .sign(new TextEncoder().encode(extra.segredo ?? segredo));
}

describe('API HTTP', () => {
  let app: FastifyInstance;
  let users: FakeUsers;
  let queries: FakeQueries;
  let supabase: FakeSupabase;
  const clienteId = randomUUID();
  const adminId = randomUUID();

  beforeAll(async () => {
    users = new FakeUsers();
    queries = new FakeQueries();
    supabase = new FakeSupabase();
    app = await buildApp({
      dependencias: {
        userRepository: users,
        authService: new AuthService(users, supabase),
        userService: new UserService(users, new FakeEnderecos(), new FakeContatos(), supabase),
        pedidoService: new PedidoService(queries, new FakePedidoRepository(), users),
        verificarToken: criarVerificadorDeToken({ authIssuer: issuer, audience: 'authenticated', jwtSecret: segredo })
      }
    });
  });

  afterAll(() => app.close());

  beforeEach(() => {
    users.users.clear();
    const cliente = User.register(clienteId, 'Maria', Email.create('maria@teste.com'), UserRole.Cliente);
    cliente.completeRegistration('12345678901');
    void users.add(cliente);
    void users.add(User.register(adminId, 'Admin', Email.create('admin@teste.com'), UserRole.Admin));
    queries.pedido = null;
    supabase.erro = undefined;
  });

  const get = async (url: string, sub?: string) =>
    app.inject({ method: 'GET', url, headers: sub ? { authorization: `Bearer ${await token(sub)}` } : {} });

  describe('autenticação', () => {
    it('sem token responde 401 em ProblemDetails com WWW-Authenticate', async () => {
      const resposta = await get('/api/v1/home/summary');
      expect(resposta.statusCode).toBe(401);
      expect(resposta.headers['www-authenticate']).toBe('Bearer');
      expect(resposta.headers['content-type']).toContain('application/problem+json');
      expect(resposta.json()).toMatchObject({ status: 401, title: 'Unauthorized', type: expect.stringContaining('15.5.2') });
      expect(resposta.json().traceId).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-00$/);
    });

    it.each([
      ['assinatura de outro segredo', { segredo: 'outro-segredo-qualquer-com-tamanho-suficiente' }],
      ['audiência errada', { aud: 'anon' }],
      ['emissor errado', { iss: 'https://outro.supabase.co/auth/v1' }],
      ['expirado além da tolerância', { expira: '-2m' }]
    ])('recusa token com %s', async (_caso, extra) => {
      const resposta = await app.inject({
        method: 'GET',
        url: '/api/v1/home/summary',
        headers: { authorization: `Bearer ${await token(clienteId, extra)}` }
      });
      expect(resposta.statusCode).toBe(401);
      expect(resposta.headers['www-authenticate']).toBe('Bearer error="invalid_token"');
    });

    it('aceita token expirado dentro da tolerância de 1 minuto', async () => {
      const resposta = await app.inject({
        method: 'GET',
        url: '/api/v1/home/summary',
        headers: { authorization: `Bearer ${await token(clienteId, { expira: '-30s' })}` }
      });
      expect(resposta.statusCode).toBe(200);
    });

    it('recusa usuário inativo', async () => {
      users.users.get(clienteId)!.deactivate();
      expect((await get('/api/v1/home/summary', clienteId)).statusCode).toBe(401);
    });

    it('usuário sem perfil local continua autenticado (para finalizar o cadastro)', async () => {
      const semPerfil = randomUUID();
      expect((await get('/api/v1/home/summary', semPerfil)).statusCode).toBe(200);
      const me = await get('/api/v1/users/me', semPerfil);
      expect(me.statusCode).toBe(404);
      expect(me.json().detail).toBe(`Usuário '${semPerfil}' não foi encontrado.`);
    });

    it('rotas de Admin respondem 403 para Cliente e 200 para Admin', async () => {
      expect((await get('/api/v1/users', clienteId)).statusCode).toBe(403);
      const lista = await get('/api/v1/users', adminId);
      expect(lista.statusCode).toBe(200);
      expect(lista.json()).toHaveLength(2);
    });
  });

  describe('contrato', () => {
    it('omite campos nulos e mantém nomes em camelCase', async () => {
      const resposta = await get('/api/v1/users/me', adminId);
      expect(resposta.statusCode).toBe(200);
      expect(Object.keys(resposta.json()).sort()).toEqual(['createdAt', 'email', 'id', 'isActive', 'name', 'role']);
    });

    it('Home e pedidos não podem ser cacheados', async () => {
      const resposta = await get('/api/v1/home/summary', clienteId);
      expect(resposta.headers['cache-control']).toBe('no-store,no-cache');
      expect(resposta.headers.pragma).toBe('no-cache');
    });

    it('pedido inexistente: 404 com detail e instance, sem cache', async () => {
      const id = randomUUID();
      const resposta = await get(`/api/v1/orders/${id}`, clienteId);
      expect(resposta.statusCode).toBe(404);
      expect(resposta.headers['cache-control']).toBe('no-cache,no-store');
      expect(resposta.json()).toMatchObject({
        title: 'Recurso não encontrado',
        detail: `Pedido '${id}' não foi encontrado.`,
        instance: `GET /api/v1/orders/${id}`
      });
    });

    it('id fora do formato Guid responde 404 sem chegar no serviço', async () => {
      const chamadas = queries.calls;
      const resposta = await get('/api/v1/orders/abc', clienteId);
      expect(resposta.statusCode).toBe(404);
      expect(resposta.json().title).toBe('Not Found');
      expect(queries.calls).toBe(chamadas);
    });

    it('aceita Guid em outros formatos e normaliza', async () => {
      const id = randomUUID();
      queries.pedido = pedidoDeTeste(id);
      const resposta = await get(`/api/v1/orders/{${id.replace(/-/g, '').toUpperCase()}}`, clienteId);
      expect(resposta.statusCode).toBe(200);
      expect(queries.lastPedidoId).toBe(id);
    });

    it('validação responde 400 no formato do ModelState do ASP.NET', async () => {
      const resposta = await get('/api/v1/orders?page=0&pageSize=51&status=Foo', clienteId);
      expect(resposta.statusCode).toBe(400);
      expect(resposta.headers['content-type']).toBe('application/json; charset=utf-8');
      expect(resposta.headers['cache-control']).toBeUndefined();
      const corpo = resposta.json();
      expect(corpo.title).toBe('One or more validation errors occurred.');
      expect(Object.keys(corpo.errors).sort()).toEqual(['Page', 'PageSize', 'Status']);
    });

    it('validação de corpo usa caminhos aninhados', async () => {
      const resposta = await app.inject({
        method: 'POST',
        url: '/api/v1/orders',
        headers: { authorization: `Bearer ${await token(clienteId)}` },
        payload: { categoria: 'Elétrica', descricao: 'curta', localizacao: 'Aldeota', fotos: [{ url: 'nao-e-url' }] }
      });
      expect(resposta.statusCode).toBe(400);
      expect(Object.keys(resposta.json().errors).sort()).toEqual(['Descricao', 'Fotos[0].Url']);
    });

    it('JSON inválido e corpo vazio respondem 400', async () => {
      const auth = { authorization: `Bearer ${await token(clienteId)}`, 'content-type': 'application/json' };
      const invalido = await app.inject({ method: 'POST', url: '/api/v1/orders', headers: auth, payload: '{ruim' });
      expect(invalido.statusCode).toBe(400);
      const vazio = await app.inject({ method: 'POST', url: '/api/v1/orders', headers: auth, payload: '' });
      expect(vazio.statusCode).toBe(400);
    });

    it('regra de domínio responde 400 com detail que o front exibe', async () => {
      users.users.set(clienteId, User.register(clienteId, 'Maria', Email.create('maria@teste.com'), UserRole.Cliente));
      const resposta = await app.inject({
        method: 'POST',
        url: '/api/v1/orders',
        headers: { authorization: `Bearer ${await token(clienteId)}` },
        payload: { categoria: 'Elétrica', descricao: 'Tomada sem energia.', localizacao: 'Aldeota' }
      });
      expect(resposta.statusCode).toBe(400);
      expect(resposta.json()).toMatchObject({ title: 'Requisição inválida', detail: 'Finalize o cadastro antes de criar um pedido.' });
    });

    it('criação de pedido responde 201 com Location absoluto', async () => {
      queries.pedido = pedidoDeTeste(randomUUID());
      const resposta = await app.inject({
        method: 'POST',
        url: '/api/v1/orders',
        headers: { authorization: `Bearer ${await token(clienteId)}`, host: 'api.resolvai.test' },
        payload: { categoria: 'Elétrica', descricao: 'Tomada sem energia.', localizacao: 'Aldeota' }
      });
      expect(resposta.statusCode).toBe(201);
      expect(resposta.headers.location).toBe(`http://api.resolvai.test/api/v1/orders/${queries.pedido.id}`);
    });

    it('login com usuário inativo responde 401 com detail "Usuário inativo."', async () => {
      users.users.get(clienteId)!.deactivate();
      supabase.session = {
        accessToken: 't',
        tokenType: 'bearer',
        expiresAtUtc: new Date(),
        refreshToken: null,
        user: { id: clienteId, email: 'maria@teste.com' }
      };
      const resposta = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'maria@teste.com', password: 'x' } });
      expect(resposta.statusCode).toBe(401);
      expect(resposta.json().detail).toBe('Usuário inativo.');
    });

    it('credenciais recusadas pelo Supabase respondem 401', async () => {
      supabase.erro = new UnauthorizedException();
      const resposta = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'maria@teste.com', password: 'x' } });
      expect(resposta.statusCode).toBe(401);
      expect(resposta.json().detail).toBe('Credenciais inválidas.');
    });

    it('cadastro com e-mail existente responde 409', async () => {
      const resposta = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: { name: 'Maria', email: 'maria@teste.com', password: 'SenhaForte123' }
      });
      expect(resposta.statusCode).toBe(409);
      expect(resposta.headers['cache-control']).toBe('no-cache,no-store');
    });

    it('erro inesperado responde 500 sem vazar detalhes', async () => {
      supabase.erro = new Error('falha interna com dado sensível');
      const resposta = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: { name: 'Nova', email: 'nova@teste.com', password: 'SenhaForte123' }
      });
      expect(resposta.statusCode).toBe(500);
      expect(resposta.json().detail).toBe('Ocorreu um erro inesperado ao processar a requisição.');
      expect(resposta.body).not.toContain('sensível');
    });

    it('publica o OpenAPI e o Swagger', async () => {
      const openapi = await app.inject({ method: 'GET', url: '/openapi/v1.json' });
      expect(openapi.statusCode).toBe(200);
      const doc = openapi.json();
      expect(doc.components.securitySchemes.Bearer).toMatchObject({ type: 'http', scheme: 'bearer' });
      expect(doc.paths['/api/v1/orders'].get.security).toEqual([{ Bearer: [] }]);
      expect(doc.paths['/api/v1/auth/login'].post.security).toBeUndefined();
      expect((await app.inject({ method: 'GET', url: '/swagger/' })).statusCode).toBe(200);
    });
  });
});
