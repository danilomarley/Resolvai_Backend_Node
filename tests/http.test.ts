import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { SignJWT } from 'jose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/api/app.js';
import { criarVerificadorDeToken } from '../src/api/authentication.js';
import { UnauthorizedException } from '../src/application/errors.js';
import { AssistentePedidoService } from '../src/application/services/assistente-pedido-service.js';
import { AuthService } from '../src/application/services/auth-service.js';
import { FornecedorService } from '../src/application/services/fornecedor-service.js';
import { AvaliacaoService } from '../src/application/services/avaliacao-service.js';
import { PropostaFornecedorService } from '../src/application/services/proposta-fornecedor-service.js';
import type { IPropostaFornecedorRepository } from '../src/application/dtos/propostas-fornecedor.js';
import { FotoPedidoService } from '../src/application/services/foto-pedido-service.js';
import { PedidoService } from '../src/application/services/pedido-service.js';
import { PropostaService } from '../src/application/services/proposta-service.js';
import { PrestadorService, type IPrestadorRepository } from '../src/application/services/prestador-service.js';
import { PropostaPrestadorService, type IPropostaPrestadorRepository } from '../src/application/services/proposta-prestador-service.js';
import { UserService } from '../src/application/services/user-service.js';
import { Email } from '../src/domain/email.js';
import { UserRole } from '../src/domain/enums.js';
import { User } from '../src/domain/user.js';
import {
  FakeArmazenamento,
  FakeAssistente,
  FakeContatos,
  FakeEspecialidades,
  FakeFornecedores,
  FakeEnderecos,
  FakePedidoRepository,
  FakePropostaRepository,
  FakeQueries,
  FakeSupabase,
  FakeUsers,
  pedidoDeTeste,
  propostaDeTeste
} from './fakes.js';

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
  let propostas: FakePropostaRepository;
  let supabase: FakeSupabase;
  const clienteId = randomUUID();
  const adminId = randomUUID();

  beforeAll(async () => {
    users = new FakeUsers();
    queries = new FakeQueries();
    propostas = new FakePropostaRepository();
    supabase = new FakeSupabase();
    const fornecedores = new FakeFornecedores();
    const especialidades = new FakeEspecialidades();
    const fornecedorService = new FornecedorService(users, fornecedores, especialidades, supabase);
    app = await buildApp({
      dependencias: {
        avaliacaoService: new AvaliacaoService({ async criar() { return 'notFound'; }, async consultar() { return undefined; }, async resumo() { return { count: 0, averageRating: null }; } }),
        userRepository: users,
        authService: new AuthService(users, supabase, fornecedores),
        fornecedorService,
        propostaFornecedorService: new PropostaFornecedorService(fornecedorService, {} as IPropostaFornecedorRepository, new FakeArmazenamento()),
        especialidadeQueries: especialidades,
        userService: new UserService(users, new FakeEnderecos(), new FakeContatos(), supabase),
        pedidoService: new PedidoService(queries, new FakePedidoRepository(), users),
        propostaService: new PropostaService(propostas, queries),
        prestadorService: new PrestadorService({ async listCategorias() { return []; } } as unknown as IPrestadorRepository, users),
        propostaPrestadorService: new PropostaPrestadorService({} as unknown as IPropostaPrestadorRepository, fornecedorService),
        fotoPedidoService: new FotoPedidoService(new FakeArmazenamento(), users),
        assistentePedidoService: new AssistentePedidoService(new FakeAssistente()),
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
    propostas.propostas = [];
    propostas.detalhe = null;
    propostas.markResult = true;
    propostas.marked = 0;
    propostas.calls = 0;
    supabase.erro = undefined;
  });

  const get = async (url: string, sub?: string) =>
    app.inject({ method: 'GET', url, headers: sub ? { authorization: `Bearer ${await token(sub)}` } : {} });

  describe('autenticação', () => {
    it('conclui perfil profissional para a própria conta autenticada e preserva o CPF existente', async () => {
      const url = '/api/v1/fornecedores/me/complete-registration';
      const payload = { name: 'Fornecedor Legado', tipoPessoa: 'PF', cpf: '52998224725', nomeExibicao: 'Fornecedor Legado',
        telefone: '85999999999', cidadeAtuacao: 'Fortaleza', ufAtuacao: 'CE', especialidades: ['eletrica'] };
      expect((await app.inject({ method: 'POST', url, payload })).statusCode).toBe(401);
      expect((await app.inject({ method: 'POST', url, payload, headers: { authorization: `Bearer ${await token(clienteId)}` } })).statusCode).toBe(409);
      const prestadorId = randomUUID();
      await users.add(User.register(prestadorId, 'Legado', Email.create('legado-http@teste.com'), UserRole.Prestador));
      const headers = { authorization: `Bearer ${await token(prestadorId)}` };
      expect((await app.inject({ method: 'POST', url, payload: { ...payload, email: 'outra@teste.com' }, headers })).statusCode).toBe(400);
      const response = await app.inject({ method: 'POST', url, payload, headers });
      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({ idUsuario: prestadorId, tipoPessoa: 'PF', email: 'legado-http@teste.com' });
      expect(response.headers['cache-control']).toBe('no-store');
      expect((await app.inject({ method: 'POST', url, payload, headers })).statusCode).toBe(409);
    });
    it.each(['/api/v1/auth/register-provider', '/api/v1/auth/register'])('limita cadastro por IP antes da criacao privilegiada: %s', async url => {
      const respostas = [];
      for (let i = 0; i < 11; i++) respostas.push(await app.inject({ method: 'POST', url, payload: {}, remoteAddress: '203.0.113.20' }));
      expect(respostas.slice(0, 10).every(resposta => resposta.statusCode === 400)).toBe(true);
      expect(respostas[10]?.statusCode).toBe(429);
    });
    it('recusa login com UUID diferente mesmo quando o email coincide', async () => {
      supabase.session = { accessToken: 'token', tokenType: 'bearer', expiresAtUtc: new Date(), refreshToken: null,
        user: { id: randomUUID(), email: 'maria@teste.com' } };
      const resposta = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: 'maria@teste.com', password: 'senha' } });
      expect(resposta.statusCode).toBe(401);
    });

    it('claims de papel sem perfil local nao concedem administracao', async () => {
      const jwt = await new SignJWT({ role: 'Admin', email: 'sem-perfil@teste.com' })
        .setProtectedHeader({ alg: 'HS256' }).setSubject(randomUUID()).setIssuer(issuer)
        .setAudience('authenticated').setExpirationTime('5m').sign(new TextEncoder().encode(segredo));
      expect((await app.inject({ method: 'GET', url: '/api/v1/users', headers: { authorization: `Bearer ${jwt}` } })).statusCode).toBe(403);
    });

    it('alteração autenticada exige Bearer e usa a sessão do sujeito verificado', async () => {
      const payload = { newPassword: 'SenhaNova123' };
      expect((await app.inject({ method: 'POST', url: '/api/v1/auth/change-password', payload })).statusCode).toBe(401);
      const jwt = await token(clienteId);
      const resposta = await app.inject({ method: 'POST', url: '/api/v1/auth/change-password', payload,
        headers: { authorization: `Bearer ${jwt}` } });
      expect(resposta.statusCode).toBe(200);
      expect(supabase.senhasAlteradas.at(-1)?.userId).toBe('sessao-verificada');
    });

    it('check-email retorna a mesma resposta para conta existente e ausente', async () => {
      const chamar = (email: string) => app.inject({ method: 'POST', url: '/api/v1/auth/check-email', payload: { email } });
      const existente = await chamar('maria@teste.com');
      const ausente = await chamar('ausente@teste.com');
      expect(ausente.statusCode).toBe(200);
      expect(ausente.json()).toEqual(existente.json());
    });
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
  describe('propostas do pedido (#83)', () => {
    const pedidoId = randomUUID();
    const propostaId = randomUUID();

    it('exige autenticação', async () => {
      expect((await get(`/api/v1/orders/${pedidoId}/proposals`)).statusCode).toBe(401);
      expect((await get(`/api/v1/orders/${pedidoId}/proposals/${propostaId}`)).statusCode).toBe(401);
    });

    it('lista com os padrões do contrato (preço crescente) e sem cache', async () => {
      propostas.propostas = [propostaDeTeste(propostaId, { value: 900, deadlineDays: 5, providerRating: { average: 4.5, count: 2 } })];
      const resposta = await get(`/api/v1/orders/${pedidoId}/proposals`, clienteId);
      expect(resposta.statusCode).toBe(200);
      expect(resposta.headers['cache-control']).toBe('no-store,no-cache');
      expect(propostas.lastList).toEqual({ orderId: pedidoId, customerId: clienteId, sort: 'price', direction: 'asc' });
      expect(resposta.json()).toEqual([
        expect.objectContaining({ id: propostaId, value: 900, deadlineDays: 5, providerRating: { average: 4.5, count: 2 }, createdAt: expect.any(String) })
      ]);
      expect(resposta.json()[0]).not.toHaveProperty('description');
    });

    it('repassa sort e direction sem diferenciar maiúsculas; rating começa pelo melhor', async () => {
      await get(`/api/v1/orders/${pedidoId}/proposals?sort=DEADLINE&direction=Desc`, clienteId);
      expect(propostas.lastList).toMatchObject({ sort: 'deadline', direction: 'desc' });
      await get(`/api/v1/orders/${pedidoId}/proposals?sort=rating`, clienteId);
      expect(propostas.lastList).toMatchObject({ sort: 'rating', direction: 'desc' });
    });

    it('ordenação inválida responde 400 no formato do ModelState, sem consultar', async () => {
      const resposta = await get(`/api/v1/orders/${pedidoId}/proposals?sort=nome&direction=lado`, clienteId);
      expect(resposta.statusCode).toBe(400);
      expect(Object.keys(resposta.json().errors).sort()).toEqual(['Direction', 'Sort']);
      expect(propostas.calls).toBe(0);
    });

    it('pedido inexistente ou de outro cliente responde 404', async () => {
      propostas.propostas = null;
      const resposta = await get(`/api/v1/orders/${pedidoId}/proposals`, clienteId);
      expect(resposta.statusCode).toBe(404);
      expect(resposta.json()).toMatchObject({ detail: `Pedido '${pedidoId}' não foi encontrado.`, instance: `GET /api/v1/orders/${pedidoId}/proposals` });
    });

    it('ids fora do formato Guid respondem 404 sem consultar', async () => {
      expect((await get('/api/v1/orders/abc/proposals', clienteId)).statusCode).toBe(404);
      expect((await get(`/api/v1/orders/${pedidoId}/proposals/abc`, clienteId)).statusCode).toBe(404);
      expect((await get(`/api/v1/orders/abc/proposals/${propostaId}`, clienteId)).statusCode).toBe(404);
      expect(propostas.calls).toBe(0);
    });

    it('detalhe devolve o resumo do prestador e marca como visualizada', async () => {
      propostas.detalhe = {
        ...propostaDeTeste(propostaId),
        providerProfile: { memberSince: '2026-01-10T12:00:00.000Z', completedServices: 3 }
      };
      const resposta = await get(`/api/v1/orders/${pedidoId}/proposals/${propostaId}`, clienteId);
      expect(resposta.statusCode).toBe(200);
      expect(resposta.headers['cache-control']).toBe('no-store,no-cache');
      expect(resposta.json()).toMatchObject({ id: propostaId, status: 'Viewed', providerProfile: { completedServices: 3 } });
      expect(propostas.marked).toBe(1);
      expect(propostas.lastDetail).toEqual({ orderId: pedidoId, proposalId: propostaId, customerId: clienteId });
    });

    it('proposta inexistente responde 404 com detail', async () => {
      const resposta = await get(`/api/v1/orders/${pedidoId}/proposals/${propostaId}`, clienteId);
      expect(resposta.statusCode).toBe(404);
      expect(resposta.json().detail).toBe(`Proposta '${propostaId}' não foi encontrado.`);
    });

    it('publica as rotas autenticadas no OpenAPI', async () => {
      const doc = (await app.inject({ method: 'GET', url: '/openapi/v1.json' })).json();
      expect(doc.paths['/api/v1/orders/{id}/proposals'].get.security).toEqual([{ Bearer: [] }]);
      expect(doc.paths['/api/v1/orders/{id}/proposals/{proposalId}'].get.tags).toEqual(['Propostas']);
    });
  });
});
