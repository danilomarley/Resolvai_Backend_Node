import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import type { FastifyInstance } from 'fastify';
import { SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/api/app.js';
import { criarVerificadorDeToken } from '../src/api/authentication.js';
import { ServicoIndisponivelException } from '../src/application/errors.js';
import { AssistentePedidoService } from '../src/application/services/assistente-pedido-service.js';
import { AuthService } from '../src/application/services/auth-service.js';
import { FornecedorService } from '../src/application/services/fornecedor-service.js';
import { EspecialidadeQueries } from '../src/infrastructure/repositories/especialidade-queries.js';
import { FornecedorRepository } from '../src/infrastructure/repositories/fornecedor-repository.js';
import { FotoPedidoService } from '../src/application/services/foto-pedido-service.js';
import { PedidoService } from '../src/application/services/pedido-service.js';
import { UserService } from '../src/application/services/user-service.js';
import { createDatabase, type Database } from '../src/infrastructure/database.js';
import { ContatoRepository } from '../src/infrastructure/repositories/contato-repository.js';
import { EnderecoRepository } from '../src/infrastructure/repositories/endereco-repository.js';
import { PedidoQueries } from '../src/infrastructure/repositories/pedido-queries.js';
import { OportunidadeQueries } from '../src/infrastructure/repositories/oportunidade-queries.js';
import { PropostaRepository } from '../src/infrastructure/repositories/proposta-repository.js';
import { PropostaService } from '../src/application/services/proposta-service.js';
import { PedidoRepository } from '../src/infrastructure/repositories/pedido-repository.js';
import { UserRepository } from '../src/infrastructure/repositories/user-repository.js';
import { FakeArmazenamento, FakeAssistente, FakeSupabase } from './fakes.js';

// PostgreSQL real (PGlite, em memória) com os mesmos scripts de db/scripts, acessado pelo driver pg da API.
const issuer = 'https://projeto-teste.supabase.co/auth/v1';
const segredo = 'segredo-de-teste-com-tamanho-suficiente-para-hs256';

const ids = {
  cliente: '10000000-0000-4000-8000-000000000001',
  outroCliente: '10000000-0000-4000-8000-000000000002',
  prestador: '10000000-0000-4000-8000-000000000003',
  admin: '10000000-0000-4000-8000-000000000004'
};

const pedido = (n: number) => `20000000-0000-4000-8000-00000000000${n}`;

async function portaLivre(): Promise<number> {
  return new Promise((resolve, reject) => {
    const servidor = createServer();
    servidor.once('error', reject);
    servidor.listen(0, '127.0.0.1', () => {
      const endereco = servidor.address();
      servidor.close(() => resolve(typeof endereco === 'object' && endereco ? endereco.port : 0));
    });
  });
}

const token = (sub: string, email = 'novo@teste.com') =>
  new SignJWT({ email, role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(issuer)
    .setAudience('authenticated')
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(segredo));

describe('Integração com PostgreSQL', () => {
  let pglite: PGlite;
  let servidor: PGLiteSocketServer;
  let database: Database;
  let app: FastifyInstance;
  const supabase = new FakeSupabase();
  const armazenamento = new FakeArmazenamento();
  const assistente = new FakeAssistente();

  const chamar = async (method: 'GET' | 'POST' | 'PATCH', url: string, sub: string, payload?: unknown, email?: string) =>
    app.inject({ method, url, payload: payload as object, headers: { authorization: `Bearer ${await token(sub, email)}` } });

  beforeAll(async () => {
    pglite = await PGlite.create({ extensions: { citext, pgcrypto } });

    // O Supabase já traz o schema storage; aqui basta o mínimo que o script 012 usa.
    await pglite.exec(`
      create role anon;
      create role authenticated;
      create schema if not exists storage;
      create table if not exists storage.buckets (
        id text primary key, name text not null, public boolean, file_size_limit bigint, allowed_mime_types text[]
      );
    `);

    const pasta = join(import.meta.dirname, '..', 'db', 'scripts');
    for (const arquivo of readdirSync(pasta).filter(nome => nome.endsWith('.sql')).sort()) {
      await pglite.exec(readFileSync(join(pasta, arquivo), 'utf8'));
    }

    await pglite.exec(`
      insert into users (id, name, email, role, cpf) values
        ('${ids.cliente}', 'Maria Cliente', 'maria@teste.com', 'Cliente', '11111111111'),
        ('${ids.outroCliente}', 'João Cliente', 'joao@teste.com', 'Cliente', null),
        ('${ids.prestador}', 'Pedro Prestador', 'pedro@teste.com', 'Prestador', '22222222222'),
        ('${ids.admin}', 'Ana Admin', 'ana@teste.com', 'Admin', null);

      insert into pedidos (id, id_cliente, escopo, status, data_criacao, data_atualizacao) values
        ('${pedido(1)}', '${ids.cliente}', '{"titulo":"Infiltração na laje","categoria":"Impermeabilização","descricao":"Umidade após chuva","localizacao":"Aldeota, Fortaleza","extra":1}', 'aberto', now() - interval '1 day', null),
        ('${pedido(2)}', '${ids.cliente}', '{"categoria":"Hidráulica"}', 'em_andamento', now() - interval '2 days', now() - interval '1 day'),
        ('${pedido(3)}', '${ids.cliente}', null, 'concluido', now() - interval '10 days', null),
        ('${pedido(4)}', '${ids.cliente}', '{"titulo":"   "}', 'cancelado', now() - interval '20 days', null),
        ('${pedido(5)}', '${ids.cliente}', '{"titulo":"Mesma data A"}', 'aberto', now() - interval '30 days', null),
        ('${pedido(6)}', '${ids.cliente}', '{"titulo":"Mesma data B"}', 'aberto', now() - interval '30 days', null),
        ('${pedido(7)}', '${ids.outroCliente}', '{"titulo":"De outro cliente"}', 'aberto', now(), null);

      update pedidos set data_criacao = (select data_criacao from pedidos where id = '${pedido(5)}') where id = '${pedido(6)}';

      insert into fotos_pedido (id, id_pedido, foto, descricao) values
        ('30000000-0000-4000-8000-000000000001', '${pedido(1)}', 'https://exemplo.com/a.jpg', 'Mancha'),
        ('30000000-0000-4000-8000-000000000002', '${pedido(1)}', 'pedidos/b.jpg', null);

      insert into propostas (id, id_pedido, id_prestador, status, valor, prazo, descricao, garantia) values
        ('40000000-0000-4000-8000-000000000001', '${pedido(1)}', '${ids.prestador}', 'enviada', 900.00, '5 dias', null, null),
        ('40000000-0000-4000-8000-000000000002', '${pedido(1)}', '${ids.prestador}', 'visualizada', 500.50, null, 'Mais barata', '90 dias'),
        ('40000000-0000-4000-8000-000000000003', '${pedido(2)}', '${ids.prestador}', 'escolhida', 1100.50, '3 dias', null, null),
        ('40000000-0000-4000-8000-000000000004', '${pedido(2)}', '${ids.prestador}', 'enviada', 700.00, null, null, null);
    `);

    const porta = await portaLivre();
    servidor = new PGLiteSocketServer({ db: pglite, port: porta, host: '127.0.0.1' });
    await servidor.start();

    database = createDatabase({
      connectionString: `postgresql://postgres:postgres@127.0.0.1:${porta}/postgres`,
      ssl: false,
      commandTimeoutSeconds: 10,
      maxConnections: 1
    });

    const users = new UserRepository(database);
    const fornecedores = new FornecedorRepository(database);
    const especialidades = new EspecialidadeQueries(database);
    const fornecedorService = new FornecedorService(users, fornecedores, especialidades, supabase, new OportunidadeQueries(database));
    app = await buildApp({
      logger: process.env.DEBUG_LOG ? { level: 'error' } : false,
      dependencias: {
        userRepository: users,
        authService: new AuthService(users, supabase, fornecedores),
        fornecedorService,
        propostaService: new PropostaService(fornecedorService, new PropostaRepository(database), armazenamento),
        especialidadeQueries: especialidades,
        userService: new UserService(users, new EnderecoRepository(database), new ContatoRepository(database), supabase),
        pedidoService: new PedidoService(new PedidoQueries(database), new PedidoRepository(database), users),
        fotoPedidoService: new FotoPedidoService(armazenamento, users),
        assistentePedidoService: new AssistentePedidoService(assistente),
        verificarToken: criarVerificadorDeToken({ authIssuer: issuer, audience: 'authenticated', jwtSecret: segredo })
      }
    });
  });

  afterAll(async () => {
    await app?.close();
    await database?.close();
    await servidor?.stop();
    await pglite?.close();
  });

  it('Home: contadores, propostas e 5 pedidos recentes', async () => {
    const resposta = await chamar('GET', '/api/v1/home/summary', ids.cliente);
    expect(resposta.statusCode).toBe(200);
    const corpo = resposta.json();

    expect(corpo.orders).toEqual({
      total: 6,
      pending: 3,
      inProgress: 1,
      completed: 1,
      cancelled: 1,
      active: 4,
      createdLast7Days: 2
    });
    expect(corpo.proposals).toEqual({ total: 4, awaitingDecision: 2, unviewed: 1 });
    expect(corpo.recentOrders.map((p: { id: string }) => p.id)).toEqual([pedido(1), pedido(2), pedido(3), pedido(4), pedido(6)]);

    const [primeiro, segundo, terceiro, quarto] = corpo.recentOrders;
    expect(primeiro).toMatchObject({
      title: 'Infiltração na laje',
      category: 'Impermeabilização',
      location: 'Aldeota, Fortaleza',
      status: 'Pending',
      proposalsCount: 2
    });
    expect(primeiro).not.toHaveProperty('updatedAt');
    expect(primeiro).not.toHaveProperty('chosenProposalValue');
    expect(segundo).toMatchObject({ title: 'Hidráulica', status: 'InProgress', chosenProposalValue: 1100.5 });
    expect(typeof segundo.updatedAt).toBe('string');
    expect(terceiro).toMatchObject({ title: 'Pedido', status: 'Completed', proposalsCount: 0 });
    expect(terceiro).not.toHaveProperty('category');
    expect(terceiro).not.toHaveProperty('location');
    expect(quarto).toMatchObject({ title: 'Pedido', status: 'Cancelled' });
  });

  it('CPF pode repetir entre papeis e permanece unico dentro do mesmo papel', async () => {
    const users = new UserRepository(database);
    expect(await users.existsByCpf('22222222222', ids.outroCliente, 'Cliente')).toBe(false);
    expect(await users.existsByCpf('22222222222', ids.outroCliente, 'Prestador')).toBe(true);
  });

  describe('fornecedores', () => {
    const pf = { name: 'Profissional Teste', email: 'profissional@teste.com', password: 'SenhaForte123', tipoPessoa: 'PF',
      nomeExibicao: 'Profissional', cpf: '529.982.247-25', telefone: '(85) 99999-1234', cidadeAtuacao: 'Fortaleza',
      ufAtuacao: 'ce', raioAtendimentoKm: 20, bio: 'Serviços', registroProfissional: 'REG-1', especialidades: ['pintura', 'eletrica', 'pintura'] };
    const pj = { ...pf, tipoPessoa: 'PJ', cpf: null, cnpj: '11.222.333/0001-81', email: 'empresa@teste.com' };
    let profissionalId: string;
    let cadastroIp = 0;
    const cadastrar = (payload: object) => app.inject({ method: 'POST', url: '/api/v1/auth/register-provider', payload, remoteAddress: `192.0.2.${++cadastroIp}` });

    it('lista especialidades ativas publicamente', async () => {
      const resposta = await app.inject({ method: 'GET', url: '/api/v1/especialidades' });
      expect(resposta.statusCode).toBe(200);
      expect(resposta.json()).toContainEqual({ codigo: 'eletrica', nome: 'Elétrica' });
      await database.query("insert into especialidades(codigo,nome,is_active) values ('inativa','Inativa',false)");
      expect((await app.inject({ method: 'GET', url: '/api/v1/especialidades' })).json().some((e: { codigo: string }) => e.codigo === 'inativa')).toBe(false);
    });

    it('cadastra PF, persiste todas as tabelas e agrega os dados no GET', async () => {
      profissionalId = randomUUID();
      supabase.novoUsuario = { id: profissionalId, email: pf.email };
      const resposta = await cadastrar(pf);
      expect(resposta.statusCode).toBe(201);
      expect(resposta.headers['cache-control']).toBe('no-store');
      expect(resposta.json()).toMatchObject({ idUsuario: profissionalId, name: pf.name, email: pf.email, cpf: '52998224725',
        tipoPessoa: 'PF', telefone: '85999991234', ufAtuacao: 'CE', especialidades: ['eletrica', 'pintura'], bio: 'Serviços' });
      const leitura = await chamar('GET', '/api/v1/fornecedores/me', profissionalId);
      expect(leitura.statusCode).toBe(200);
      expect(leitura.headers['cache-control']).toBe('no-store');
      expect(leitura.json()).toEqual(resposta.json());
      expect((await database.query('select * from contatos where id_usuario=$1 and principal=true', [profissionalId]))).toHaveLength(1);
    });

    it('recusa duplicidade de email, CPF Prestador e CNPJ; CPF Cliente pode repetir', async () => {
      expect((await cadastrar(pf)).statusCode).toBe(409);
      expect((await cadastrar({ ...pf, email: 'outra@teste.com' })).statusCode).toBe(409);
      await database.query("insert into users (id,name,email,role,cpf) values ($1,'Cliente','cpfcliente@teste.com','Cliente','12345678909')", [randomUUID()]);
      supabase.novoUsuario = { id: randomUUID(), email: 'mesmocpf@teste.com' };
      expect((await cadastrar({ ...pf, email: 'mesmocpf@teste.com', cpf: '12345678909' })).statusCode).toBe(201);
      supabase.novoUsuario = { id: randomUUID(), email: pj.email };
      const empresa = await cadastrar(pj);
      expect(empresa.statusCode).toBe(201);
      expect(empresa.json()).not.toHaveProperty('cpf');
      expect(empresa.json()).toMatchObject({ tipoPessoa: 'PJ', cnpj: '11222333000181' });
      const finalizarComoCliente = await chamar('POST', '/api/v1/users/me/complete-registration', empresa.json().idUsuario, {
        name: 'Empresa', cpf: '98765432100',
        endereco: { logradouro: 'Rua Teste', numero: '1', bairro: 'Centro', cidade: 'Fortaleza', estado: 'CE', cep: '60000000' },
        contato: { tipo: 'telefone', valor: '85999990000' }
      });
      expect(finalizarComoCliente.statusCode).toBe(403);
      expect((await chamar('GET', '/api/v1/fornecedores/me', empresa.json().idUsuario)).json()).not.toHaveProperty('cpf');
      expect((await cadastrar({ ...pj, email: 'outraempresa@teste.com' })).statusCode).toBe(409);
    });

    it.each([
      { cpf: '11111111111' }, { cpf: '52998224724' }, { cnpj: '11222333000181' }, { telefone: 'abc85999991234' },
      { ufAtuacao: 'XX' }, { raioAtendimentoKm: 0 }, { raioAtendimentoKm: 201 }, { especialidades: [] },
      { especialidades: ['nao_existe'] }, { especialidades: ['inativa'] }, { tipoPessoa: 'PJ', cnpj: '11222333000180', cpf: null },
      { tipoPessoa: 'PJ', cnpj: '11222333000181', cpf: '52998224725' }
    ])('valida os dados antes do signup: %j', async extra => {
      expect((await cadastrar({ ...pf, email: 'invalido@teste.com', ...extra })).statusCode).toBe(400);
    });

    it('protege o perfil com 401, 403 e 404 sem autorizar por email', async () => {
      expect((await app.inject({ method: 'GET', url: '/api/v1/fornecedores/me' })).statusCode).toBe(401);
      expect((await chamar('GET', '/api/v1/fornecedores/me', ids.cliente)).statusCode).toBe(403);
      expect((await chamar('GET', '/api/v1/fornecedores/me', ids.prestador)).statusCode).toBe(404);
      expect((await chamar('GET', '/api/v1/fornecedores/me', randomUUID(), undefined, pf.email)).statusCode).toBe(401);
    });

    it('PATCH persiste todos os editaveis e recusa alteracao de documentos/tipo/email', async () => {
      const payload = { name: 'Novo Nome', nomeExibicao: 'Exibição Nova', telefone: '8533334444', cidadeAtuacao: 'Caucaia',
        ufAtuacao: 'CE', raioAtendimentoKm: 45, bio: null, registroProfissional: null, especialidades: ['hidraulica'] };
      const resposta = await chamar('PATCH', '/api/v1/fornecedores/me', profissionalId, payload);
      expect(resposta.statusCode).toBe(200);
      expect(resposta.json()).toMatchObject({ ...payload, cpf: '52998224725', email: pf.email, tipoPessoa: 'PF', updatedAt: expect.any(String) });
      expect((await chamar('GET', '/api/v1/fornecedores/me', profissionalId)).json()).toEqual(resposta.json());
      for (const proibido of [{ email: 'novo@teste.com' }, { cpf: '12345678909' }, { cnpj: '11222333000181' }, { tipoPessoa: 'PJ' }]) {
        expect((await chamar('PATCH', '/api/v1/fornecedores/me', profissionalId, { ...payload, ...proibido })).statusCode).toBe(400);
      }
      const invalido = await chamar('PATCH', '/api/v1/fornecedores/me', profissionalId, { ...payload, name: 'Nao gravar', especialidades: ['inativa'] });
      expect(invalido.statusCode).toBe(400);
      expect((await chamar('GET', '/api/v1/fornecedores/me', profissionalId)).json().name).toBe('Novo Nome');
    });

    it('Prestador nao contorna as regras de telefone pelo PATCH generico de Cliente', async () => {
      const resposta = await chamar('PATCH', '/api/v1/users/me/profile', profissionalId, { contato: { tipo: 'whatsapp', valor: 'telefone invalido' } });
      expect(resposta.statusCode).toBe(403);
      expect((await chamar('GET', '/api/v1/fornecedores/me', profissionalId)).json().telefone).toBe('8533334444');
    });

    it('rollback no cadastro deixa Auth intacto e permite retomar com o mesmo UUID', async () => {
      const id = randomUUID();
      supabase.novoUsuario = { id, email: 'retomada@teste.com' };
      await database.query(`create function falha_contato_teste() returns trigger language plpgsql as $$ begin
        if new.valor='85900000000' then raise exception 'falha local simulada'; end if; return new; end $$`);
      await database.query('create trigger falha_contato_teste before insert on contatos for each row execute function falha_contato_teste()');
      const payload = { ...pj, email: 'retomada@teste.com', cnpj: '12.ABC.345/01DE-35', telefone: '85900000000' };
      const falha = await cadastrar(payload);
      expect(falha.statusCode).toBe(503);
      expect(await database.query('select * from users where id=$1', [id])).toHaveLength(0);
      expect(await database.query('select * from fornecedores where id_usuario=$1', [id])).toHaveLength(0);
      await database.query('drop trigger falha_contato_teste on contatos');
      await database.query('drop function falha_contato_teste()');
      expect((await cadastrar(payload)).statusCode).toBe(201);
      expect(await database.query('select * from users where id=$1', [id])).toHaveLength(1);
      supabase.novoUsuario = undefined;
    });

    it('falha tardia no PATCH desfaz nome, perfil, telefone e especialidades', async () => {
      const anterior = (await chamar('GET', '/api/v1/fornecedores/me', profissionalId)).json();
      await database.query(`create function falha_edicao_teste() returns trigger language plpgsql as $$ begin
        if new.valor='85911111111' then raise exception 'falha local simulada'; end if; return new; end $$`);
      await database.query('create trigger falha_edicao_teste before update on contatos for each row execute function falha_edicao_teste()');
      try {
        const resposta = await chamar('PATCH', '/api/v1/fornecedores/me', profissionalId, {
          name: 'Nome que deve voltar', nomeExibicao: 'Exibição que deve voltar', telefone: '85911111111',
          cidadeAtuacao: 'Fortaleza', ufAtuacao: 'CE', raioAtendimentoKm: 50, especialidades: ['pintura']
        });
        expect(resposta.statusCode).toBe(500);
        expect(resposta.json().detail).not.toContain('falha local simulada');
        expect((await chamar('GET', '/api/v1/fornecedores/me', profissionalId)).json()).toEqual(anterior);
      } finally {
        await database.query('drop trigger falha_edicao_teste on contatos');
        await database.query('drop function falha_edicao_teste()');
      }
    });

    it('login-provider e refresh exigem identidade local ativa e perfil Prestador', async () => {
      const session = (id: string) => ({ accessToken: 'access', tokenType: 'bearer', refreshToken: 'rotated', expiresAtUtc: new Date(), user: { id, email: pf.email } });
      supabase.session = session(ids.cliente);
      const login = () => app.inject({ method: 'POST', url: '/api/v1/auth/login-provider', payload: { email: pf.email, password: pf.password } });
      expect((await login()).statusCode).toBe(403);
      supabase.session = session(ids.prestador);
      expect((await login()).statusCode).toBe(404);
      supabase.session = session(profissionalId);
      const logado = await login();
      expect(logado.statusCode).toBe(200);
      expect(logado.json().user).toMatchObject({ id: profissionalId, role: 'Prestador' });
      const refresh = () => app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken: 'refresh' } });
      expect((await refresh()).json()).toMatchObject({ accessToken: 'access', refreshToken: 'rotated' });
      supabase.session = session(randomUUID());
      expect((await refresh()).statusCode).toBe(401);
      await database.query('update users set is_active=false where id=$1', [profissionalId]);
      supabase.session = session(profissionalId);
      expect((await login()).statusCode).toBe(401);
      expect((await refresh()).statusCode).toBe(401);
      expect((await chamar('GET', '/api/v1/fornecedores/me', profissionalId)).statusCode).toBe(401);
    });
  });

  it('Home de outro cliente só conta os próprios pedidos', async () => {
    const corpo = (await chamar('GET', '/api/v1/home/summary', ids.outroCliente)).json();
    expect(corpo.orders.total).toBe(1);
    expect(corpo.proposals.total).toBe(0);
  });

  it('lista paginada com filtro e desempate por id', async () => {
    const pagina = (await chamar('GET', '/api/v1/orders?page=2&pageSize=4', ids.cliente)).json();
    expect(pagina).toMatchObject({ page: 2, pageSize: 4, totalItems: 6, totalPages: 2 });
    expect(pagina.items.map((p: { id: string }) => p.id)).toEqual([pedido(6), pedido(5)]);

    const pendentes = (await chamar('GET', '/api/v1/orders?status=Pending', ids.cliente)).json();
    expect(pendentes.totalItems).toBe(3);
    expect(pendentes.items.every((p: { status: string }) => p.status === 'Pending')).toBe(true);

    const alem = (await chamar('GET', '/api/v1/orders?page=9', ids.cliente)).json();
    expect(alem).toMatchObject({ items: [], totalItems: 6, totalPages: 1 });
  });

  it('detalhe com escopo, fotos e propostas (escolhida primeiro, depois por valor)', async () => {
    const corpo = (await chamar('GET', `/api/v1/orders/${pedido(1)}`, ids.cliente)).json();
    expect(corpo).toMatchObject({
      title: 'Infiltração na laje',
      category: 'Impermeabilização',
      description: 'Umidade após chuva',
      location: 'Aldeota, Fortaleza',
      scope: { titulo: 'Infiltração na laje', extra: 1 }
    });
    expect(corpo.photos).toEqual([
      { id: '30000000-0000-4000-8000-000000000001', url: 'https://exemplo.com/a.jpg', description: 'Mancha' },
      { id: '30000000-0000-4000-8000-000000000002', url: 'pedidos/b.jpg' }
    ]);
    expect(corpo.proposals.map((p: { value: number }) => p.value)).toEqual([500.5, 900]);
    expect(corpo.proposals[0]).toMatchObject({ providerName: 'Pedro Prestador', status: 'Viewed', warranty: '90 dias' });

    const comEscolhida = (await chamar('GET', `/api/v1/orders/${pedido(2)}`, ids.cliente)).json();
    expect(comEscolhida.proposals.map((p: { status: string }) => p.status)).toEqual(['Chosen', 'Sent']);
    expect(comEscolhida.description).toBe('');

    const semEscopo = (await chamar('GET', `/api/v1/orders/${pedido(3)}`, ids.cliente)).json();
    expect(semEscopo).not.toHaveProperty('scope');
  });

  it('pedido de outro cliente responde 404', async () => {
    const resposta = await chamar('GET', `/api/v1/orders/${pedido(7)}`, ids.cliente);
    expect(resposta.statusCode).toBe(404);
  });

  it('finaliza cadastro de usuário sem perfil e recusa repetição', async () => {
    const novo = randomUUID();
    const payload = {
      name: 'Nova Cliente',
      cpf: '333.333.333-33',
      endereco: { logradouro: 'Rua A', numero: '10', bairro: 'Centro', cidade: 'Fortaleza', estado: 'ce', cep: '60000-000' },
      contato: { tipo: 'whatsapp', valor: '85999999999' }
    };

    const resposta = await chamar('POST', '/api/v1/users/me/complete-registration', novo, payload);
    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).toMatchObject({ id: novo, name: 'Nova Cliente', email: 'novo@teste.com', role: 'Cliente', cpf: '33333333333' });

    const [endereco] = await database.query<{ estado: string; cep: string; principal: boolean }>(
      'select estado, cep, principal from enderecos where id_usuario = $1',
      [novo]
    );
    expect(endereco).toEqual({ estado: 'CE', cep: '60000000', principal: true });

    const repetido = await chamar('POST', '/api/v1/users/me/complete-registration', novo, payload);
    expect(repetido.statusCode).toBe(409);
    expect(repetido.json().detail).toBe('Cadastro já finalizado.');

    const cpfDeOutro = await chamar('POST', '/api/v1/users/me/complete-registration', ids.outroCliente, { ...payload, cpf: '11111111111' });
    expect(cpfDeOutro.statusCode).toBe(409);
    expect(cpfDeOutro.json().detail).toBe("Já existe um usuário com o CPF '11111111111'.");
  });

  it('cria pedido com escopo e fotos e devolve 201 com o detalhe', async () => {
    const resposta = await chamar('POST', '/api/v1/orders', ids.cliente, {
      titulo: '  Troca de disjuntor ',
      categoria: 'Elétrica',
      descricao: 'Disjuntor desarma toda hora.',
      localizacao: 'Meireles, Fortaleza',
      urgencia: '',
      fotos: [{ url: 'https://exemplo.com/quadro.jpg', descricao: 'Quadro' }]
    });

    expect(resposta.statusCode).toBe(201);
    const corpo = resposta.json();
    expect(corpo).toMatchObject({ title: 'Troca de disjuntor', status: 'Pending', photos: [{ url: 'https://exemplo.com/quadro.jpg' }] });
    expect(resposta.headers.location).toMatch(new RegExp(`/api/v1/orders/${corpo.id}$`));
    expect(corpo.scope).toEqual({
      titulo: 'Troca de disjuntor',
      categoria: 'Elétrica',
      descricao: 'Disjuntor desarma toda hora.',
      localizacao: 'Meireles, Fortaleza'
    });

    const semCadastro = await chamar('POST', '/api/v1/orders', ids.outroCliente, {
      categoria: 'Elétrica',
      descricao: 'Disjuntor desarma toda hora.',
      localizacao: 'Meireles'
    });
    expect(semCadastro.statusCode).toBe(400);
    expect(semCadastro.json().detail).toBe('Finalize o cadastro antes de criar um pedido.');
  });

  it('admin desativa usuário e o token dele passa a ser recusado', async () => {
    const lista = await chamar('GET', '/api/v1/users', ids.admin);
    expect(lista.statusCode).toBe(200);

    const desativado = await chamar('PATCH', `/api/v1/users/${ids.outroCliente}/status`, ids.admin, { isActive: false });
    expect(desativado.statusCode).toBe(200);
    expect(desativado.json().isActive).toBe(false);

    expect((await chamar('GET', '/api/v1/users/me', ids.outroCliente)).statusCode).toBe(401);
  });

  it('cadastro público cria perfil Cliente; e-mail é case-insensitive (citext)', async () => {
    const resposta = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { name: 'Carla', email: 'Carla@Teste.com', password: 'SenhaForte123' }
    });
    expect(resposta.statusCode).toBe(201);
    expect(resposta.json()).toMatchObject({ email: 'carla@teste.com', role: 'Cliente' });

    const repetido = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { name: 'Carla', email: 'MARIA@teste.com', password: 'SenhaForte123' }
    });
    expect(repetido.statusCode).toBe(409);
  });

  describe('perfil (#61)', () => {
    const payload = {
      name: 'Perfil Cliente',
      cpf: '444.444.444-44',
      endereco: { logradouro: 'Rua B', numero: '20', bairro: 'Meireles', cidade: 'Fortaleza', estado: 'CE', cep: '60100-000' },
      contato: { tipo: 'telefone', valor: '85988887777' }
    };

    it('consulta e altera nome, endereço e contato sem mudar o CPF', async () => {
      const id = randomUUID();
      expect((await chamar('POST', '/api/v1/users/me/complete-registration', id, payload, 'perfil@teste.com')).statusCode).toBe(200);

      const emailDeOutro = await chamar('POST', '/api/v1/users/me/complete-registration', randomUUID(), payload, 'perfil@teste.com');
      expect(emailDeOutro.statusCode).toBe(409);

      const perfil = (await chamar('GET', '/api/v1/users/me/profile', id)).json();
      expect(perfil).toMatchObject({
        user: { id, name: 'Perfil Cliente', cpf: '44444444444' },
        endereco: { logradouro: 'Rua B', numero: '20', cep: '60100000', estado: 'CE' },
        contato: { tipo: 'telefone', valor: '85988887777' }
      });
      expect(perfil.endereco).not.toHaveProperty('complemento');

      const alterado = await chamar('PATCH', '/api/v1/users/me/profile', id, {
        name: '  Novo Nome ',
        endereco: { ...payload.endereco, logradouro: 'Av. C', complemento: 'Apto 1', cep: '60200000', estado: 'sp' },
        contato: { tipo: 'whatsapp', valor: '85911112222' }
      });
      expect(alterado.statusCode).toBe(200);
      expect(alterado.json()).toMatchObject({
        user: { name: 'Novo Nome', cpf: '44444444444' },
        endereco: { logradouro: 'Av. C', complemento: 'Apto 1', cep: '60200000', estado: 'SP' },
        contato: { tipo: 'whatsapp', valor: '85911112222' }
      });

      const [contagem] = await database.query<{ total: number }>(
        'select count(*) as "total" from enderecos where id_usuario = $1',
        [id]
      );
      expect(contagem?.total).toBe(1);
    });

    it('cria endereço e contato quando o usuário finalizado ainda não tem', async () => {
      const resposta = await chamar('PATCH', '/api/v1/users/me/profile', ids.cliente, {
        endereco: payload.endereco,
        contato: payload.contato
      });
      expect(resposta.statusCode).toBe(200);
      expect(resposta.json().endereco.logradouro).toBe('Rua B');
    });

    it('exige cadastro finalizado para endereço e contato e ao menos um campo', async () => {
      const semCpf = await chamar('PATCH', '/api/v1/users/me/profile', ids.admin, { contato: payload.contato });
      expect(semCpf.statusCode).toBe(400);
      expect(semCpf.json().detail).toBe('Finalize o cadastro antes de alterar endereço e contato.');

      const nomeSemCpf = await chamar('PATCH', '/api/v1/users/me/profile', ids.admin, { name: 'Ana A.' });
      expect(nomeSemCpf.statusCode).toBe(200);

      const vazio = await chamar('PATCH', '/api/v1/users/me/profile', ids.admin, {});
      expect(vazio.statusCode).toBe(400);
    });
  });

  describe('recuperação de senha (#70)', () => {
    const post = async (url: string, payload: unknown, ip = '10.0.0.1', sub = ids.cliente) =>
      app.inject({ method: 'POST', url, payload: payload as object, remoteAddress: ip,
        headers: { authorization: `Bearer ${await token(sub)}` } });

    it('nao divulga se o email existe', async () => {
      const existe = await post('/api/v1/auth/check-email', { email: 'MARIA@teste.com' });
      expect(existe.statusCode).toBe(200);

      const naoExiste = await post('/api/v1/auth/check-email', { email: 'ninguem@teste.com' });
      expect(naoExiste.statusCode).toBe(200);
      expect(naoExiste.json()).toEqual(existe.json());
    });

    it('troca a senha no Supabase Auth do usuário certo e exige 8 caracteres', async () => {
      const curta = await post('/api/v1/auth/reset-password', { email: 'maria@teste.com', newPassword: '123' }, '10.0.0.2');
      expect(curta.statusCode).toBe(400);

      const resposta = await post('/api/v1/auth/reset-password', { email: 'maria@teste.com', newPassword: 'NovaSenha123' }, '10.0.0.2');
      expect(resposta.statusCode).toBe(200);
      expect(supabase.senhasAlteradas.at(-1)).toEqual({ userId: ids.cliente, password: 'NovaSenha123' });
    });

    it('limita tentativas pelo sujeito verificado entre IPs diferentes', async () => {
      const ultimas = [];
      for (let i = 0; i < 6; i++) {
        ultimas.push(await post('/api/v1/auth/reset-password', { email: 'pedro@teste.com', newPassword: 'SenhaNova123' }, `10.0.1.${i}`, ids.prestador));
      }
      expect(ultimas.slice(0, 5).every(r => r.statusCode === 200)).toBe(true);
      expect(ultimas[5]!.statusCode).toBe(429);
    });
  });

  describe('fotos do pedido (#67)', () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);

    const enviar = async (sub: string, conteudo: Buffer, tipo: string) => {
      const limite = '----resolvai';
      const corpo = Buffer.concat([
        Buffer.from(`--${limite}\r\nContent-Disposition: form-data; name="foto"; filename="foto"\r\nContent-Type: ${tipo}\r\n\r\n`),
        conteudo,
        Buffer.from(`\r\n--${limite}--\r\n`)
      ]);
      return app.inject({
        method: 'POST',
        url: '/api/v1/orders/photos',
        payload: corpo,
        headers: { authorization: `Bearer ${await token(sub)}`, 'content-type': `multipart/form-data; boundary=${limite}` }
      });
    };

    it('grava a foto na pasta do cliente e devolve a URL pública', async () => {
      const resposta = await enviar(ids.cliente, png, 'image/png');
      expect(resposta.statusCode).toBe(201);
      expect(resposta.json().url).toMatch(new RegExp(`/storage/v1/object/public/pedidos/${ids.cliente}/[0-9a-f-]+\\.png$`));
      expect(armazenamento.enviados.at(-1)).toMatchObject({ contentType: 'image/png', tamanho: png.length });
    });

    it('recusa arquivo que não é imagem, mesmo com Content-Type de imagem', async () => {
      const resposta = await enviar(ids.cliente, Buffer.from('<script>alert(1)</script>'), 'image/png');
      expect(resposta.statusCode).toBe(400);
      expect(resposta.json().detail).toBe('Envie uma foto JPG, PNG ou WEBP.');
    });

    it('recusa foto acima de 5 MB e cliente sem cadastro finalizado', async () => {
      const grande = Buffer.concat([png, Buffer.alloc(5 * 1024 * 1024)]);
      const resposta = await enviar(ids.cliente, grande, 'image/png');
      expect(resposta.statusCode).toBe(400);
      expect(resposta.json().detail).toBe('A foto deve ter no máximo 5 MB.');

      const semCadastro = await enviar(ids.admin, png, 'image/png');
      expect(semCadastro.statusCode).toBe(400);
      expect(semCadastro.json().detail).toBe('Finalize o cadastro antes de enviar fotos.');
    });

    it('recusa requisição que não é multipart', async () => {
      const resposta = await chamar('POST', '/api/v1/orders/photos', ids.cliente, { url: 'x' });
      expect(resposta.statusCode).toBe(400);
    });
  });

  describe('assistente de pedido (#69)', () => {
    it('repassa a conversa e devolve resposta e escopo', async () => {
      const resposta = await chamar('POST', '/api/v1/orders/assistant', ids.cliente, {
        messages: [{ role: 'user', content: 'A tomada da cozinha parou de funcionar.' }]
      });
      expect(resposta.statusCode).toBe(200);
      expect(resposta.json()).toEqual({
        reply: 'Em qual bairro e cidade fica o imóvel?',
        scope: { categoria: 'Elétrica', descricao: 'Tomada da cozinha sem energia.' },
        complete: false
      });
      expect(assistente.ultimaConversa).toHaveLength(1);
    });

    it('valida a conversa', async () => {
      const terminaComAssistente = await chamar('POST', '/api/v1/orders/assistant', ids.cliente, {
        messages: [
          { role: 'user', content: 'Oi' },
          { role: 'assistant', content: 'Olá' }
        ]
      });
      expect(terminaComAssistente.statusCode).toBe(400);
    });

    it('responde 503 quando o assistente está indisponível', async () => {
      assistente.erro = new ServicoIndisponivelException('O assistente de pedidos não está configurado neste servidor.');
      const resposta = await chamar('POST', '/api/v1/orders/assistant', ids.cliente, {
        messages: [{ role: 'user', content: 'Preciso pintar a sala.' }]
      });
      assistente.erro = undefined;
      expect(resposta.statusCode).toBe(503);
      expect(resposta.json().detail).toBe('O assistente de pedidos não está configurado neste servidor.');
    });
  });

  describe('oportunidades por especialidade do fornecedor', () => {
    const provider = randomUUID();
    const otherProvider = randomUUID();
    const missingProfile = randomUUID();
    const inactiveProvider = randomUUID();
    const orderIds = Array.from({ length: 12 }, () => randomUUID());
    const feed = '/api/v1/fornecedores/me/oportunidades';
    const search = '?search=OP-TEST';

    beforeAll(async () => {
      for (const [index, id] of [provider, otherProvider, missingProfile, inactiveProvider].entries()) {
        await database.query(`insert into users(id,name,email,role,is_active) values($1,'Fornecedor de teste',$2,'Prestador',$3)`, [id, `oportunidade${index}@test.invalid`, id !== inactiveProvider]);
      }
      for (const id of [provider, otherProvider, inactiveProvider]) {
        await database.query(`insert into fornecedores(id_usuario,tipo_pessoa,nome_exibicao,cidade_atuacao,uf_atuacao) values($1,'PF','Teste','Fortaleza','CE')`, [id]);
      }
      await database.query("insert into especialidades(codigo,nome,is_active) values('op_inativa','OP inativa',false)");
      await database.query(`insert into fornecedor_especialidades(id_usuario,codigo_especialidade) values ($1,'eletrica'),($1,'hidraulica'),($1,'op_inativa'),($2,'pintura'),($3,'eletrica')`, [provider, otherProvider, inactiveProvider]);
      const categories = ['Elétrica', 'eletrica', '  ELÉTRICA  ', 'HIDRAULICA', 'Pintura', 'Reformas', 'Elétrica', 'Elétrica', 'Elétrica', 'OP inativa', null, 'Elétrica'];
      for (let index = 0; index < categories.length; index++) {
        const scope = { titulo: `OP-TEST ${index}`, categoria: categories[index], localizacao: 'Cidade distante, SP', descricao: 'Descrição real', detalhes: 'Detalhes reais', especificacoes: 'Especificações reais', urgencia: 'Urgente', segredoInterno: 'não expor' };
        await database.query(`insert into pedidos(id,id_cliente,escopo,status,data_criacao) values($1,$2,$3::jsonb,$4,'2026-11-01T12:00:00Z')`,
          [orderIds[index], index === 11 ? provider : ids.cliente, JSON.stringify(scope), index === 6 ? 'em_andamento' : index === 7 ? 'concluido' : 'aberto']);
      }
      await database.query(`insert into propostas(id_pedido,id_prestador,status,valor) values($1,$2,'escolhida',100),($3,$2,'enviada',200),($3,$2,'visualizada',300)`, [orderIds[8], otherProvider, orderIds[0]]);
      await database.query(`insert into fotos_pedido(id_pedido,foto,descricao) values($1,'https://example.invalid/foto.jpg','Foto do cliente')`, [orderIds[0]]);
    });

    it('lista todos os abertos compatíveis, por código ou nome sem diferença de acentos, sem filtrar região', async () => {
      const response = await chamar('GET', `${feed}${search}`, provider);
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      const body = response.json();
      expect(body.totalItems).toBe(4);
      expect(body.totalPages).toBe(1);
      expect(body.items.map((item: { id: string }) => item.id).sort()).toEqual(orderIds.slice(0, 4).sort());
      expect(body.specialties.map((item: { codigo: string }) => item.codigo)).toEqual(['eletrica', 'hidraulica']);
      expect(body.items.find((item: { id: string }) => item.id === orderIds[0])).toMatchObject({ category: 'Elétrica', specialtyCode: 'eletrica', proposalsCount: 2 });
      expect(body.items.every((item: { location: string }) => item.location === 'Cidade distante, SP')).toBe(true);
    });

    it('pagina sem duplicatas e filtra por especialidade e busca literal', async () => {
      const first = (await chamar('GET', `${feed}${search}&pageSize=2`, provider)).json();
      const second = (await chamar('GET', `${feed}${search}&pageSize=2&page=2`, provider)).json();
      expect(first.totalItems).toBe(4);
      expect(first.totalPages).toBe(2);
      expect(new Set([...first.items, ...second.items].map((item: { id: string }) => item.id)).size).toBe(4);
      const category = (await chamar('GET', `${feed}${search}&category=hidraulica`, provider)).json();
      expect(category.totalItems).toBe(1);
      expect(category.items[0].id).toBe(orderIds[3]);
      expect((await chamar('GET', `${feed}${search}&category=pintura`, provider)).json().totalItems).toBe(0);
      expect((await chamar('GET', `${feed}?search=%25`, provider)).json().totalItems).toBe(0);
      const sorted = (await chamar('GET', `${feed}${search}&sort=proposals`, provider)).json();
      expect(sorted.items.at(-1).id).toBe(orderIds[0]);
    });

    it('protege a listagem e usa as especialidades do sujeito do token', async () => {
      expect((await app.inject({ method: 'GET', url: feed })).statusCode).toBe(401);
      for (const id of [ids.cliente, ids.admin]) expect((await chamar('GET', feed, id)).statusCode).toBe(403);
      expect((await chamar('GET', feed, missingProfile)).statusCode).toBe(404);
      expect((await chamar('GET', feed, inactiveProvider)).statusCode).toBe(401);
      expect((await chamar('GET', `${feed}${search}`, otherProvider)).json().items.map((item: { id: string }) => item.id)).toEqual([orderIds[4]]);
      expect((await chamar('GET', `${feed}${search}&providerId=${otherProvider}`, provider)).statusCode).toBe(400);
      for (const query of ['page=0', 'pageSize=51', 'sort=anything']) expect((await chamar('GET', `${feed}?${query}`, provider)).statusCode).toBe(400);
    });

    it('mostra detalhes e fotos reais apenas enquanto o pedido está elegível, sem propostas ou dados privados', async () => {
      const detail = await chamar('GET', `${feed}/${orderIds[0]}`, provider);
      expect(detail.statusCode).toBe(200);
      expect(detail.json()).toMatchObject({ id: orderIds[0], description: 'Descrição real', details: 'Detalhes reais', specifications: 'Especificações reais', proposalsCount: 2, photos: [{ url: 'https://example.invalid/foto.jpg' }] });
      expect(detail.json()).not.toHaveProperty('scope');
      expect(detail.json()).not.toHaveProperty('proposals');
      expect(detail.json().client).toMatchObject({ name: 'Maria Cliente', ordersCount: expect.any(Number), completedOrdersCount: expect.any(Number) });
      expect(detail.json().client.completedOrdersCount).toBeGreaterThan(0);
      expect(Number.isFinite(Date.parse(detail.json().client.memberSince))).toBe(true);
      expect(Object.keys(detail.json().client).sort()).toEqual(['completedOrdersCount', 'memberSince', 'name', 'ordersCount']);
      expect(detail.body).not.toContain('segredoInterno');
      for (const id of [orderIds[4], orderIds[6], orderIds[7], orderIds[8], orderIds[9], orderIds[11], randomUUID(), 'invalid']) {
        expect((await chamar('GET', `${feed}/${id}`, provider)).statusCode).toBe(404);
      }
      await database.query("update pedidos set status='cancelado' where id=$1", [orderIds[0]]);
      expect((await chamar('GET', `${feed}/${orderIds[0]}`, provider)).statusCode).toBe(404);
    });

    it('retorna vazio e reavalia imediatamente especialidades alteradas ou desativadas', async () => {
      await database.query('delete from fornecedor_especialidades where id_usuario=$1', [otherProvider]);
      const empty = (await chamar('GET', `${feed}${search}`, otherProvider)).json();
      expect(empty).toMatchObject({ items: [], totalItems: 0, totalPages: 0, specialties: [] });
      await database.query("insert into fornecedor_especialidades(id_usuario,codigo_especialidade) values($1,'hidraulica')", [otherProvider]);
      expect((await chamar('GET', `${feed}${search}`, otherProvider)).json().items.map((item: { id: string }) => item.id)).toEqual([orderIds[3]]);
      // A specialty specific to this fixture can be disabled without affecting other tests.
      await database.query("update especialidades set is_active=true where codigo='op_inativa'");
      expect((await chamar('GET', `${feed}/${orderIds[9]}`, provider)).statusCode).toBe(200);
      await database.query("update especialidades set is_active=false where codigo='op_inativa'");
      expect((await chamar('GET', `${feed}/${orderIds[9]}`, provider)).statusCode).toBe(404);
    });
  });

  describe('envio de proposta com formulário e portfólio', () => {
    const provider = randomUUID();
    const otherProvider = randomUUID();
    const orderId = randomUUID();
    const closedId = randomUUID();
    const mismatchedId = randomUUID();
    const png = Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]);
    const makeData = () => ({ requestId: randomUUID(), valueCents: 145000, deadline: '3 dias', startDate: '2099-01-01',
      description: 'Diagnóstico e reparo completo da instalação elétrica.', materials: 'Tomada e conduítes',
      guaranteePeriod: '90 dias', guaranteeType: 'Reexecução gratuita', guaranteeConditions: 'Cobre os serviços realizados.' });
    const url = (id: string = orderId) => `/api/v1/fornecedores/me/oportunidades/${id}/propostas`;
    const multipart = (data: unknown, files: { bytes: Buffer; type: string; name: string }[] = []) => {
      const boundary = `test-${randomUUID()}`;
      const chunks: Buffer[] = [Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="proposal"\r\n\r\n${JSON.stringify(data)}\r\n`)];
      for (const file of files) chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="portfolio"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`),file.bytes,Buffer.from('\r\n'));
      chunks.push(Buffer.from(`--${boundary}--\r\n`));
      return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
    };
    const send = async (data: unknown, files: { bytes: Buffer; type: string; name: string }[] = [], sub: string = provider, id: string = orderId) => {
      const payload = multipart(data, files);
      return app.inject({ method: 'POST', url: url(id), payload: payload.body,
        headers: { 'content-type': payload.contentType, authorization: `Bearer ${await token(sub)}` } });
    };
    beforeAll(async () => {
      for (const [index, id] of [provider, otherProvider].entries()) {
        await database.query(`insert into users(id,name,email,role) values($1,'Proponente',$2,'Prestador')`, [id, `proponente${index}@test.invalid`]);
        await database.query(`insert into fornecedores(id_usuario,tipo_pessoa,nome_exibicao,cidade_atuacao,uf_atuacao) values($1,'PF','Teste','Fortaleza','CE')`, [id]);
        await database.query(`insert into fornecedor_especialidades(id_usuario,codigo_especialidade) values($1,'eletrica')`, [id]);
      }
      for (const id of [orderId, closedId, mismatchedId]) {
        await database.query(`insert into pedidos(id,id_cliente,escopo,status) values($1,$2,$3::jsonb,$4)`, [id, ids.cliente,
          JSON.stringify({ categoria: id === mismatchedId ? 'Pintura' : 'Elétrica', titulo: 'Teste de proposta' }), id === closedId ? 'concluido' : 'aberto']);
      }
    });
    it('salva todos os campos e as URLs reais das fotos e permite consultar apenas a própria proposta', async () => {
      const data = makeData();
      const response = await send(data, [{ bytes: png, type: 'image/png', name: 'trabalho.png' }]);
      expect(response.statusCode, response.body).toBe(201);
      expect(response.json()).toMatchObject({ id: data.requestId, orderId, status: 'Sent', value: 1450, deadline: '3 dias', startDate: '2099-01-01', materials: data.materials,
        warranty: { period: '90 dias', type: 'Reexecução gratuita', conditions: data.guaranteeConditions }, portfolio: [{ name: 'trabalho.png', url: expect.stringContaining('/propostas/') }] });
      const [saved] = await database.query<{ [key: string]: unknown }>('select * from propostas where id=$1', [data.requestId]);
      expect(saved).toMatchObject({ id_pedido: orderId, id_prestador: provider, valor: 1450, materiais: data.materials, garantia_prazo: '90 dias', garantia_tipo: 'Reexecução gratuita', garantia_condicoes: data.guaranteeConditions });
      expect(saved!.garantia).toContain('90 dias');
      expect((await chamar('GET', response.headers.location as string, provider)).json()).toEqual(response.json());
      expect((await chamar('GET', response.headers.location as string, otherProvider)).statusCode).toBe(404);
    });
    it('repetir uma tentativa preserva a mesma proposta sem duplicar registro ou upload', async () => {
      const data = makeData();
      const before = armazenamento.enviados.length;
      const files = [{ bytes: png, type: 'image/png', name: 'portfolio.png' }];
      const first = await send(data, files);
      const second = await send(data, files);
      expect(first.statusCode).toBe(201);
      expect(second.json()).toEqual(first.json());
      expect(armazenamento.enviados.length - before).toBe(1);
      const [count] = await database.query<{ total: number }>('select count(*) as total from propostas where id=$1', [data.requestId]);
      expect(count?.total).toBe(1);
      expect((await send({ ...data, valueCents: 200000 }, files)).statusCode).toBe(409);
    });
    it('serializa envios concorrentes com o mesmo identificador sem duplicar a proposta', async () => {
      const data = makeData();
      const files = [{ bytes: png, type: 'image/png', name: 'concorrente.png' }];
      const results = await Promise.all([send(data, files), send(data, files)]);
      expect(results.map(result => result.statusCode)).toEqual([201,201]);
      expect(results[0]!.json()).toEqual(results[1]!.json());
      const [count] = await database.query<{ total: number }>('select count(*) as total from propostas where id=$1', [data.requestId]);
      expect(count?.total).toBe(1);
      const retainedPath = results[0]!.json().portfolio[0].url.split('/public/pedidos/')[1];
      expect(armazenamento.removidos).not.toContain(retainedPath);
    });
    it('impede usuários sem permissão, pedidos encerrados, especialidades diferentes e dados inválidos', async () => {
      const raw = multipart(makeData());
      expect((await app.inject({ method: 'POST', url: url(), payload: raw.body, headers: { 'content-type': raw.contentType } })).statusCode).toBe(401);
      expect((await send(makeData(), [], ids.cliente)).statusCode).toBe(403);
      expect((await send(makeData(), [], provider, closedId)).statusCode).toBe(404);
      expect((await send(makeData(), [], provider, mismatchedId)).statusCode).toBe(404);
      for (const invalid of [{ valueCents: 0 }, { valueCents: 1.5 }, { guaranteePeriod: '' }, { startDate: '2026-02-30' }, { startDate: '2000-01-01' }, { id_prestador: otherProvider }]) {
        expect((await send({ ...makeData(), ...invalid })).statusCode).toBe(400);
      }
      expect((await send(makeData(), [{ bytes: Buffer.from('not an image'), type: 'image/png', name: 'fake.png' }])).statusCode).toBe(400);
      expect((await send(makeData(), Array.from({ length: 6 }, () => ({ bytes: png, type: 'image/png', name: 'extra.png' })))).statusCode).toBe(413);
    });
  });

  it('health check responde sem autenticação', async () => {
    const resposta = await app.inject({ method: 'GET', url: '/health' });
    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).toEqual({ status: 'ok' });
  });
});
