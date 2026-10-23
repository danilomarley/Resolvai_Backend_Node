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
import { FotoPedidoService } from '../src/application/services/foto-pedido-service.js';
import { PedidoService } from '../src/application/services/pedido-service.js';
import { UserService } from '../src/application/services/user-service.js';
import { createDatabase, type Database } from '../src/infrastructure/database.js';
import { ContatoRepository } from '../src/infrastructure/repositories/contato-repository.js';
import { EnderecoRepository } from '../src/infrastructure/repositories/endereco-repository.js';
import { PedidoQueries } from '../src/infrastructure/repositories/pedido-queries.js';
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
        userRepository: users,
        authService: new AuthService(users, supabase),
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
    expect(primeiro).toMatchObject({ title: 'Infiltração na laje', category: 'Impermeabilização', status: 'Pending', proposalsCount: 2 });
    expect(primeiro).not.toHaveProperty('updatedAt');
    expect(primeiro).not.toHaveProperty('chosenProposalValue');
    expect(segundo).toMatchObject({ title: 'Hidráulica', status: 'InProgress', chosenProposalValue: 1100.5 });
    expect(typeof segundo.updatedAt).toBe('string');
    expect(terceiro).toMatchObject({ title: 'Pedido', status: 'Completed', proposalsCount: 0 });
    expect(terceiro).not.toHaveProperty('category');
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

    it('confirma e-mail existente e recusa inexistente', async () => {
      const existe = await post('/api/v1/auth/check-email', { email: 'MARIA@teste.com' });
      expect(existe.statusCode).toBe(200);
      expect(existe.json()).toEqual({ email: 'maria@teste.com' });

      const naoExiste = await post('/api/v1/auth/check-email', { email: 'ninguem@teste.com' });
      expect(naoExiste.statusCode).toBe(404);
    });

    it('troca a senha no Supabase Auth do usuário certo e exige 8 caracteres', async () => {
      const curta = await post('/api/v1/auth/reset-password', { email: 'maria@teste.com', newPassword: '123' }, '10.0.0.2');
      expect(curta.statusCode).toBe(400);

      const resposta = await post('/api/v1/auth/reset-password', { email: 'maria@teste.com', newPassword: 'NovaSenha123' }, '10.0.0.2');
      expect(resposta.statusCode).toBe(200);
      expect(supabase.senhasAlteradas.at(-1)).toEqual({ userId: ids.cliente, password: 'NovaSenha123' });
    });

    it('limita tentativas por e-mail', async () => {
      const ultimas = [];
      for (let i = 0; i < 6; i++) {
        ultimas.push(await post('/api/v1/auth/reset-password', { email: 'pedro@teste.com', newPassword: 'SenhaNova123' }, `10.0.1.${i}`));
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

  it('health check responde sem autenticação', async () => {
    const resposta = await app.inject({ method: 'GET', url: '/health' });
    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).toEqual({ status: 'ok' });
  });
});
