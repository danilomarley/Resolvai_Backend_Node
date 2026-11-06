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
import { AvaliacaoService } from '../src/application/services/avaliacao-service.js';
import { AvaliacaoRepository } from '../src/infrastructure/repositories/avaliacao-repository.js';
import { FotoPedidoService } from '../src/application/services/foto-pedido-service.js';
import { PedidoService } from '../src/application/services/pedido-service.js';
import { PropostaService } from '../src/application/services/proposta-service.js';
import { UserService } from '../src/application/services/user-service.js';
import { createDatabase, type Database } from '../src/infrastructure/database.js';
import { ContatoRepository } from '../src/infrastructure/repositories/contato-repository.js';
import { EnderecoRepository } from '../src/infrastructure/repositories/endereco-repository.js';
import { PedidoQueries } from '../src/infrastructure/repositories/pedido-queries.js';
import { PedidoRepository } from '../src/infrastructure/repositories/pedido-repository.js';
import { PropostaRepository } from '../src/infrastructure/repositories/proposta-repository.js';
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
    app = await buildApp({
      logger: process.env.DEBUG_LOG ? { level: 'error' } : false,
      dependencias: {
        avaliacaoService: new AvaliacaoService(new AvaliacaoRepository(database)),
        userRepository: users,
        authService: new AuthService(users, supabase),
        userService: new UserService(users, new EnderecoRepository(database), new ContatoRepository(database), supabase),
        pedidoService: new PedidoService(new PedidoQueries(database), new PedidoRepository(database), users),
        propostaService: new PropostaService(new PropostaRepository(database)),
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
    const post = (url: string, payload: unknown, ip = '10.0.0.1') =>
      app.inject({ method: 'POST', url, payload: payload as object, remoteAddress: ip });

    it('solicita código sem revelar existência do e-mail', async () => {
      const existe = await post('/api/v1/auth/check-email', { email: 'MARIA@teste.com' });
      expect(existe.statusCode).toBe(200);

      const naoExiste = await post('/api/v1/auth/check-email', { email: 'ninguem@teste.com' });
      expect(naoExiste.statusCode).toBe(200);
      expect(naoExiste.json()).toEqual(existe.json());
      expect(supabase.recuperacoes).toContain('maria@teste.com');
    });

    it('troca a senha no Supabase Auth do usuário certo e exige 8 caracteres', async () => {
      const curta = await post('/api/v1/auth/reset-password', { email: 'maria@teste.com', newPassword: '123' }, '10.0.0.2');
      expect(curta.statusCode).toBe(400);

      const ausente = await post('/api/v1/auth/reset-password', { email: 'maria@teste.com', newPassword: 'NovaSenha123' }, '10.0.0.2');
      expect(ausente.statusCode).toBe(400);
      supabase.recoverySession = { accessToken: 'sessao-recuperacao', tokenType: 'bearer', refreshToken: null, expiresAtUtc: new Date(Date.now() + 60000), user: { id: ids.cliente, email: 'maria@teste.com' } };
      const resposta = await post('/api/v1/auth/reset-password', { email: 'maria@teste.com', token: '123456', newPassword: 'NovaSenha123' }, '10.0.0.2');
      expect(resposta.statusCode).toBe(200);
      expect(supabase.senhasAlteradas.at(-1)).toEqual({ userId: 'sessao-verificada', password: 'NovaSenha123' });
      expect((await post('/api/v1/auth/reset-password', { email: 'maria@teste.com', token: '123456', newPassword: 'OutraSenha123' }, '10.0.0.2')).statusCode).toBe(401);
    });

    it('limita tentativas por e-mail', async () => {
      const ultimas = [];
      for (let i = 0; i < 6; i++) {
        ultimas.push(await post('/api/v1/auth/reset-password', { email: 'pedro@teste.com', token: '000000', newPassword: 'SenhaNova123' }, `10.0.1.${i}`));
      }
      expect(ultimas.slice(0, 5).every(r => r.statusCode === 401)).toBe(true);
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

  describe('propostas do pedido (#83)', () => {
    const p = {
      cliente: '60000000-0000-4000-8000-000000000001',
      outro: '60000000-0000-4000-8000-000000000002',
      ana: '60000000-0000-4000-8000-0000000000a1',
      bruno: '60000000-0000-4000-8000-0000000000b2',
      carla: '60000000-0000-4000-8000-0000000000c3'
    };
    const pedidoA = '61000000-0000-4000-8000-000000000001';
    const pedidoVazio = '61000000-0000-4000-8000-000000000002';
    const proposta = { ana: '62000000-0000-4000-8000-0000000000a1', bruno: '62000000-0000-4000-8000-0000000000b2', carla: '62000000-0000-4000-8000-0000000000c3' };
    const url = (sufixo = '') => `/api/v1/orders/${pedidoA}/proposals${sufixo}`;
    const nomes = (corpo: { providerName: string }[]) => corpo.map(item => item.providerName);

    beforeAll(async () => {
      await pglite.exec(`
        insert into users (id, name, email, role, cpf, created_at) values
          ('${p.cliente}', 'Cliente Propostas', 'cp@teste.com', 'Cliente', '70000000011', now()),
          ('${p.outro}', 'Outro Cliente', 'oc@teste.com', 'Cliente', '70000000022', now()),
          ('${p.ana}', 'Ana Eletricista', 'ana.e@teste.com', 'Prestador', null, '2026-01-10T12:00:00Z'),
          ('${p.bruno}', 'Bruno Pedreiro', 'bruno.p@teste.com', 'Prestador', null, '2026-02-01T12:00:00Z'),
          ('${p.carla}', 'Carla Pintora', 'carla.p@teste.com', 'Prestador', null, '2026-03-01T12:00:00Z');

        insert into pedidos (id, id_cliente, escopo, status) values
          ('${pedidoA}', '${p.cliente}', '{"titulo":"Reforma"}', 'aberto'),
          ('${pedidoVazio}', '${p.cliente}', '{"titulo":"Sem propostas"}', 'aberto'),
          -- serviços já concluídos pelo prestador escolhido: Ana 2 (notas 5 e 4), Bruno 1 (nota 3)
          ('61000000-0000-4000-8000-0000000000a1', '${p.outro}', '{"titulo":"c1"}', 'concluido'),
          ('61000000-0000-4000-8000-0000000000a2', '${p.outro}', '{"titulo":"c2"}', 'concluido'),
          ('61000000-0000-4000-8000-0000000000b1', '${p.outro}', '{"titulo":"c3"}', 'concluido');

        insert into propostas (id, id_pedido, id_prestador, status, valor, prazo, prazo_dias, descricao, garantia, data_criacao) values
          ('${proposta.ana}', '${pedidoA}', '${p.ana}', 'enviada', 900.00, '10 dias', 10, 'Completa', '1 ano', '2026-10-01T10:00:00Z'),
          ('${proposta.bruno}', '${pedidoA}', '${p.bruno}', 'enviada', 500.50, 'três dias', 3, null, null, '2026-10-02T10:00:00Z'),
          ('${proposta.carla}', '${pedidoA}', '${p.carla}', 'enviada', 700.00, 'a combinar', null, null, '90 dias', '2026-10-03T10:00:00Z'),
          ('62000000-0000-4000-8000-0000000001a1', '61000000-0000-4000-8000-0000000000a1', '${p.ana}', 'escolhida', 100, null, null, null, null, now()),
          ('62000000-0000-4000-8000-0000000001a2', '61000000-0000-4000-8000-0000000000a2', '${p.ana}', 'escolhida', 100, null, null, null, null, now()),
          ('62000000-0000-4000-8000-0000000001b1', '61000000-0000-4000-8000-0000000000b1', '${p.bruno}', 'escolhida', 100, null, null, null, null, now());

        insert into avaliacoes (id_pedido, id_cliente, id_prestador, nota) values
          ('61000000-0000-4000-8000-0000000000a1', '${p.outro}', '${p.ana}', 5),
          ('61000000-0000-4000-8000-0000000000a2', '${p.outro}', '${p.ana}', 4),
          ('61000000-0000-4000-8000-0000000000b1', '${p.outro}', '${p.bruno}', 3);
      `);
    });

    it('lista por preço crescente (padrão) com data de envio, prazo e avaliação do prestador', async () => {
      const resposta = await chamar('GET', url(), p.cliente);
      expect(resposta.statusCode).toBe(200);
      const corpo = resposta.json();
      expect(nomes(corpo)).toEqual(['Bruno Pedreiro', 'Carla Pintora', 'Ana Eletricista']);
      expect(corpo[2]).toEqual({
        id: proposta.ana,
        providerId: p.ana,
        providerName: 'Ana Eletricista',
        status: 'Sent',
        value: 900,
        deadline: '10 dias',
        deadlineDays: 10,
        description: 'Completa',
        warranty: '1 ano',
        createdAt: '2026-10-01T10:00:00.000Z',
        providerRating: { average: 4.5, count: 2 }
      });
      // Sem avaliação: média nula e contagem zero; campos opcionais ausentes são omitidos.
      expect(corpo[1].providerRating).toEqual({ average: null, count: 0 });
      expect(corpo[1]).not.toHaveProperty('deadlineDays');
      expect(corpo[0].providerRating).toEqual({ average: 3, count: 1 });
    });

    it('ordena por preço, prazo e avaliação nas duas direções, deixando os sem dado por último', async () => {
      const ordem = async (query: string) => nomes((await chamar('GET', url(query), p.cliente)).json());
      expect(await ordem('?sort=price&direction=desc')).toEqual(['Ana Eletricista', 'Carla Pintora', 'Bruno Pedreiro']);
      expect(await ordem('?sort=deadline')).toEqual(['Bruno Pedreiro', 'Ana Eletricista', 'Carla Pintora']);
      expect(await ordem('?sort=deadline&direction=desc')).toEqual(['Ana Eletricista', 'Bruno Pedreiro', 'Carla Pintora']);
      expect(await ordem('?sort=rating')).toEqual(['Ana Eletricista', 'Bruno Pedreiro', 'Carla Pintora']);
      expect(await ordem('?sort=rating&direction=asc')).toEqual(['Bruno Pedreiro', 'Ana Eletricista', 'Carla Pintora']);
      expect(await ordem('?sort=RATING&direction=DESC')).toEqual(['Ana Eletricista', 'Bruno Pedreiro', 'Carla Pintora']);
    });

    it('ordenação inválida responde 400; pedido sem propostas responde lista vazia', async () => {
      expect((await chamar('GET', url('?sort=nome'), p.cliente)).statusCode).toBe(400);
      expect((await chamar('GET', url('?direction=cima'), p.cliente)).statusCode).toBe(400);
      const vazio = await chamar('GET', `/api/v1/orders/${pedidoVazio}/proposals`, p.cliente);
      expect(vazio.statusCode).toBe(200);
      expect(vazio.json()).toEqual([]);
    });

    it('só o dono vê: outro cliente e pedido inexistente respondem 404', async () => {
      expect((await chamar('GET', url(), p.outro)).statusCode).toBe(404);
      expect((await chamar('GET', url(`/${proposta.ana}`), p.outro)).statusCode).toBe(404);
      expect((await chamar('GET', `/api/v1/orders/${randomUUID()}/proposals`, p.cliente)).statusCode).toBe(404);
    });

    it('a listagem e o detalhe do pedido não marcam nada como visualizada', async () => {
      await chamar('GET', url(), p.cliente);
      await chamar('GET', `/api/v1/orders/${pedidoA}`, p.cliente);
      const status = (await pglite.query<{ status: string }>(`select status from propostas where id_pedido = '${pedidoA}'`)).rows.map(r => r.status);
      expect(status).toEqual(['enviada', 'enviada', 'enviada']);
    });

    it('detalhe traz o resumo do prestador e marca como visualizada, alimentando a Home', async () => {
      const antes = (await chamar('GET', '/api/v1/home/summary', p.cliente)).json().proposals;
      expect(antes).toEqual({ total: 3, awaitingDecision: 3, unviewed: 3 });

      const resposta = await chamar('GET', url(`/${proposta.ana}`), p.cliente);
      expect(resposta.statusCode).toBe(200);
      expect(resposta.json()).toMatchObject({
        id: proposta.ana,
        status: 'Viewed',
        providerRating: { average: 4.5, count: 2 },
        providerProfile: { memberSince: '2026-01-10T12:00:00.000Z', completedServices: 2 }
      });
      expect((await pglite.query<{ status: string }>(`select status from propostas where id = '${proposta.ana}'`)).rows[0]!.status).toBe('visualizada');

      // Abrir de novo não muda nada, e a Home passa a mostrar uma proposta a menos para conferir.
      expect((await chamar('GET', url(`/${proposta.ana}`), p.cliente)).json().status).toBe('Viewed');
      const depois = (await chamar('GET', '/api/v1/home/summary', p.cliente)).json().proposals;
      expect(depois).toEqual({ total: 3, awaitingDecision: 3, unviewed: 2 });
    });

    it('proposta de outro pedido ou inexistente responde 404 e o resumo conta só serviços concluídos', async () => {
      expect((await chamar('GET', `/api/v1/orders/${pedidoVazio}/proposals/${proposta.bruno}`, p.cliente)).statusCode).toBe(404);
      expect((await chamar('GET', url(`/${randomUUID()}`), p.cliente)).statusCode).toBe(404);
      const bruno = (await chamar('GET', url(`/${proposta.bruno}`), p.cliente)).json();
      expect(bruno.providerProfile.completedServices).toBe(1);
      const carla = (await chamar('GET', url(`/${proposta.carla}`), p.cliente)).json();
      expect(carla.providerProfile.completedServices).toBe(0);
    });

    it('o detalhe do pedido passa a incluir data de envio, prazo numérico e avaliação nas propostas', async () => {
      const corpo = (await chamar('GET', `/api/v1/orders/${pedidoA}`, p.cliente)).json();
      expect(corpo.proposals[0]).toMatchObject({ providerName: 'Bruno Pedreiro', createdAt: '2026-10-02T10:00:00.000Z', deadlineDays: 3, providerRating: { average: 3, count: 1 } });
    });

    it('a migração 014 pode ser reaplicada sem erro e sem perder dados', async () => {
      const script = readFileSync(join(import.meta.dirname, '..', 'db', 'scripts', '014_alter_propostas_data_e_prazo.sql'), 'utf8');
      await pglite.exec(script);
      const [linha] = (await pglite.query<{ prazo_dias: number }>(`select prazo_dias from propostas where id = '${proposta.ana}'`)).rows;
      expect(linha!.prazo_dias).toBe(10);
    });

    it('a migração 014 rejeita prazo numérico que não seja positivo', async () => {
      await expect(pglite.exec(`update propostas set prazo_dias = 0 where id = '${proposta.ana}'`)).rejects.toThrow(/ck_propostas_prazo_dias/);
    });
  });

  it('health check responde sem autenticação', async () => {
    const resposta = await app.inject({ method: 'GET', url: '/health' });
    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).toEqual({ status: 'ok' });
  });

  describe('avaliação pós-serviço (#92)', () => {
    const outroAvaliador = randomUUID();
    beforeAll(async () => {
      await database.query("insert into users (id, name, email, role) values ($1, 'Outro avaliador', 'avaliador@teste.com', 'Cliente')", [outroAvaliador]);
    });
    it('protege autenticação, propriedade, status, prestador e entradas inválidas', async () => {
      expect((await app.inject({ method: 'POST', url: `/api/v1/orders/${pedido(3)}/review`, payload: { rating: 5 } })).statusCode).toBe(401);
      expect((await chamar('POST', `/api/v1/orders/${pedido(3)}/review`, outroAvaliador, { rating: 5 })).statusCode).toBe(404);
      expect((await chamar('POST', `/api/v1/orders/${pedido(1)}/review`, ids.cliente, { rating: 5 })).statusCode).toBe(400);
      expect((await chamar('POST', `/api/v1/orders/${pedido(3)}/review`, ids.cliente, { rating: 5 })).statusCode).toBe(409);
      for (const rating of [0, 6, 1.5, '5', null]) {
        expect((await chamar('POST', `/api/v1/orders/${pedido(3)}/review`, ids.cliente, { rating })).statusCode).toBe(400);
      }
      expect((await chamar('POST', `/api/v1/orders/${pedido(3)}/review`, ids.cliente, { rating: 5, comment: 'x'.repeat(2001) })).statusCode).toBe(400);
      expect((await chamar('GET', `/api/v1/orders/${pedido(3)}/review`, outroAvaliador)).statusCode).toBe(404);
    });

    it('persiste uma única avaliação mesmo com dois envios simultâneos e alimenta o resumo', async () => {
      const id = randomUUID();
      await database.query("insert into pedidos (id, id_cliente, status) values ($1, $2, 'concluido')", [id, ids.cliente]);
      await database.query("insert into propostas (id_pedido, id_prestador, status, valor) values ($1, $2, 'escolhida', 100)", [id, ids.prestador]);
      expect((await chamar('GET', `/api/v1/orders/${id}/review`, ids.cliente)).json()).toBeNull();
      const results = await Promise.all([1, 2].map(() => chamar('POST', `/api/v1/orders/${id}/review`, ids.cliente, { rating: 4, comment: '  Ótimo serviço  ' })));
      expect(results.map(r => r.statusCode).sort()).toEqual([201, 409]);
      const review = (await chamar('GET', `/api/v1/orders/${id}/review`, ids.cliente)).json();
      expect(review).toMatchObject({ orderId: id, providerId: ids.prestador, rating: 4, comment: 'Ótimo serviço' });
      expect(review).not.toHaveProperty('id_cliente');
      expect((await chamar('GET', '/api/v1/users/me/reviews/summary', ids.cliente)).json()).toEqual({ count: 1, averageRating: 4 });
      expect((await chamar('GET', '/api/v1/users/me/reviews/summary', outroAvaliador)).json()).toEqual({ count: 0, averageRating: null });
      const [row] = await database.query<{ count: number }>('select count(*) as count from avaliacoes where id_pedido = $1', [id]);
      expect(row!.count).toBe(1);
    });

    it('publica o contrato autenticado no Swagger', async () => {
      const spec = (await app.inject('/openapi/v1.json')).json();
      expect(spec.paths['/api/v1/orders/{id}/review'].post.security).toEqual([{ Bearer: [] }]);
      expect(spec.paths['/api/v1/orders/{id}/review'].post.responses['201']).toBeDefined();
    });
  });
});
