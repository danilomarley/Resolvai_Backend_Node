import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { usuarioAnonimo } from '../src/application/contracts.js';
import { criarPagina } from '../src/application/dtos/common.js';
import { criarPedidoRequestSchema, listarPedidosQuerySchema, type CriarPedidoRequest } from '../src/application/dtos/pedidos.js';
import { ConflictException, NotFoundException, UnauthorizedException } from '../src/application/errors.js';
import { AuthService } from '../src/application/services/auth-service.js';
import { PedidoService } from '../src/application/services/pedido-service.js';
import { UserService } from '../src/application/services/user-service.js';
import { Email } from '../src/domain/email.js';
import { UserRole } from '../src/domain/enums.js';
import { DomainException } from '../src/domain/errors.js';
import { User } from '../src/domain/user.js';
import {
  FakeContatos,
  FakeEnderecos,
  FakePedidoRepository,
  FakeQueries,
  FakeSupabase,
  FakeUsers,
  pedidoDeTeste,
  usuario
} from './fakes.js';

const novoPedido = (extra: Partial<Record<string, unknown>> = {}): CriarPedidoRequest =>
  criarPedidoRequestSchema.parse({
    categoria: 'Elétrica',
    descricao: 'Tomada da cozinha sem energia.',
    localizacao: 'Aldeota, Fortaleza',
    urgencia: '   ',
    fotos: [{ url: 'https://x.com/a.jpg' }],
    ...extra
  });

// Portado de tests/Resolvai.Application.Checks/Program.cs da API C#.
describe('PedidoService', () => {
  const userId = randomUUID();
  const pedidoId = randomUUID();
  let queries: FakeQueries;
  let repo: FakePedidoRepository;
  let users: FakeUsers;
  let service: PedidoService;

  beforeEach(() => {
    queries = new FakeQueries();
    repo = new FakePedidoRepository();
    users = new FakeUsers();
    service = new PedidoService(queries, repo, users);
  });

  it('retorna o pedido consultado com o usuário do token', async () => {
    queries.pedido = pedidoDeTeste(pedidoId);
    const pedido = await service.getById(usuario(userId), pedidoId);
    expect(pedido).toBe(queries.pedido);
    expect(queries.lastPedidoId).toBe(pedidoId);
    expect(queries.lastUserId).toBe(userId);
  });

  it('lança NotFound quando o repositório oculta o pedido', async () => {
    await expect(service.getById(usuario(userId), pedidoId)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('resumo da Home sem pedidos usa o usuário do token', async () => {
    const resumo = await service.getSummary(usuario(userId));
    expect(resumo.orders.total).toBe(0);
    expect(resumo.proposals.total).toBe(0);
    expect(resumo.recentOrders).toHaveLength(0);
    expect(queries.lastUserId).toBe(userId);
  });

  it('encaminha filtro, paginação e padrões da lista', async () => {
    const pagina = await service.list(usuario(userId), listarPedidosQuerySchema.parse({ status: 'InProgress', page: '3', pageSize: '20' }));
    expect(pagina).toBe(queries.pagina);
    expect([queries.lastStatus, queries.lastPage, queries.lastPageSize]).toEqual(['InProgress', 3, 20]);
    expect(queries.lastUserId).toBe(userId);

    await service.list(usuario(userId), listarPedidosQuerySchema.parse({}));
    expect([queries.lastStatus, queries.lastPage, queries.lastPageSize]).toEqual([undefined, 1, 10]);
  });

  it.each([
    ['não autenticado', usuarioAnonimo],
    ['sem id', usuario(undefined)],
    ['id vazio', usuario('00000000-0000-0000-0000-000000000000')]
  ])('não consulta o banco sem identidade válida (%s)', async (_caso, user) => {
    await expect(service.getById(user, pedidoId)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.getSummary(user)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.list(user, listarPedidosQuerySchema.parse({}))).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.criar(user, novoPedido())).rejects.toBeInstanceOf(UnauthorizedException);
    expect(queries.calls).toBe(0);
  });

  it('exige cadastro finalizado e papel Cliente para criar pedido', async () => {
    await expect(service.criar(usuario(userId), novoPedido())).rejects.toThrow('Finalize o cadastro antes de criar um pedido.');

    const cliente = User.register(userId, 'Cliente', Email.create('cliente@teste.com'), UserRole.Cliente);
    users.user = cliente;
    await expect(service.criar(usuario(userId), novoPedido())).rejects.toBeInstanceOf(DomainException);

    const prestador = User.register(userId, 'Prestador', Email.create('p@teste.com'), UserRole.Prestador);
    prestador.completeRegistration('12345678901');
    users.user = prestador;
    await expect(service.criar(usuario(userId), novoPedido())).rejects.toThrow('Apenas clientes podem criar pedidos.');
    expect(repo.added).toBe(0);
  });

  it('cria o pedido e devolve o detalhe', async () => {
    const cliente = User.register(userId, 'Cliente', Email.create('cliente@teste.com'), UserRole.Cliente);
    cliente.completeRegistration('123.456.789-01');
    users.user = cliente;

    await expect(service.criar(usuario(userId), novoPedido())).rejects.toBeInstanceOf(NotFoundException);

    queries.pedido = pedidoDeTeste(pedidoId);
    const criado = await service.criar(usuario(userId), novoPedido());
    expect(criado).toBe(queries.pedido);
    expect(repo.added).toBe(2);
    expect(repo.lastClienteId).toBe(userId);
    expect(repo.lastFotos).toBe(1);

    const escopo = JSON.parse(repo.lastEscopo!);
    expect(escopo.categoria).toBe('Elétrica');
    expect(escopo).not.toHaveProperty('urgencia');
    expect(Object.keys(escopo)).toEqual(['categoria', 'descricao', 'localizacao']);
  });
});

describe('Validação dos DTOs', () => {
  it('pedido', () => {
    expect(criarPedidoRequestSchema.safeParse({ ...novoPedido(), descricao: 'curta' }).success).toBe(false);
    expect(criarPedidoRequestSchema.safeParse({ ...novoPedido(), fotos: [{ url: 'nao-e-url' }] }).success).toBe(false);
    expect(
      criarPedidoRequestSchema.safeParse({ ...novoPedido(), fotos: Array(5).fill({ url: 'https://x.com/a.jpg' }) }).success
    ).toBe(false);
    expect(criarPedidoRequestSchema.safeParse({ ...novoPedido(), categoria: '   ' }).success).toBe(false);
    expect(criarPedidoRequestSchema.safeParse(novoPedido()).success).toBe(true);
    expect(criarPedidoRequestSchema.parse({ ...novoPedido(), fotos: null }).fotos).toEqual([]);
  });

  it('lista de pedidos', () => {
    const valida = (query: Record<string, string>) => listarPedidosQuerySchema.safeParse(query).success;
    expect(valida({})).toBe(true);
    expect(valida({ page: '2147483647', pageSize: '50' })).toBe(true);
    expect(valida({ status: 'pending' })).toBe(true);
    expect(valida({ page: '0' })).toBe(false);
    expect(valida({ pageSize: '0' })).toBe(false);
    expect(valida({ pageSize: '51' })).toBe(false);
    expect(valida({ page: '1.5' })).toBe(false);
    expect(valida({ page: 'abc' })).toBe(false);
    expect(valida({ status: 'Foo' })).toBe(false);
  });

  it('página: total de páginas', () => {
    expect(criarPagina([], 1, 10, 0).totalPages).toBe(0);
    expect(criarPagina([], 1, 10, 20).totalPages).toBe(2);
    expect(criarPagina([], 1, 10, 21).totalPages).toBe(3);
  });
});

describe('AuthService', () => {
  const id = randomUUID();
  const sessao = (userId: string) => ({
    accessToken: 'token',
    tokenType: 'bearer',
    expiresAtUtc: new Date('2026-10-23T12:00:00Z'),
    refreshToken: null,
    user: { id: userId, email: 'maria@teste.com' }
  });

  it('login devolve o token e o perfil local, sem refreshToken nulo', async () => {
    const users = new FakeUsers();
    users.user = User.register(id, 'Maria', Email.create('maria@teste.com'), UserRole.Cliente);
    const supabase = new FakeSupabase();
    supabase.session = sessao(id);

    const resposta = await new AuthService(users, supabase).login({ email: 'Maria@Teste.com', password: 'x' });
    expect(resposta.user.email).toBe('maria@teste.com');
    expect(resposta.expiresAtUtc).toBe('2026-10-23T12:00:00.000Z');
    expect(resposta).not.toHaveProperty('refreshToken', null);
    expect(resposta.refreshToken).toBeUndefined();
  });

  it('login recusa perfil inexistente ou inativo com as mensagens que o front trata', async () => {
    const users = new FakeUsers();
    const supabase = new FakeSupabase();
    supabase.session = sessao(id);
    const service = new AuthService(users, supabase);

    await expect(service.login({ email: 'maria@teste.com', password: 'x' })).rejects.toThrow(
      'Usuário autenticado no Supabase sem perfil local.'
    );

    const inativo = User.register(id, 'Maria', Email.create('maria@teste.com'), UserRole.Cliente);
    inativo.deactivate();
    users.user = inativo;
    await expect(service.login({ email: 'maria@teste.com', password: 'x' })).rejects.toThrow('Usuário inativo.');
  });

  it('cadastro sempre cria Cliente e recusa e-mail repetido', async () => {
    const users = new FakeUsers();
    const service = new AuthService(users, new FakeSupabase());

    const criado = await service.register({ name: '  Maria ', email: 'MARIA@teste.com', password: 'SenhaForte123' });
    expect(criado).toMatchObject({ name: 'Maria', email: 'maria@teste.com', role: 'Cliente', isActive: true });
    expect(criado.cpf).toBeUndefined();

    await expect(service.register({ name: 'Maria', email: 'maria@teste.com', password: 'SenhaForte123' })).rejects.toThrow(
      "Já existe um usuário com o e-mail 'maria@teste.com'."
    );
  });
});

describe('UserService.completeRegistration', () => {
  const id = randomUUID();
  const request = {
    name: 'Maria',
    cpf: '123.456.789-01',
    endereco: { logradouro: 'Rua A', numero: '10', bairro: 'Centro', cidade: 'Fortaleza', estado: 'ce', cep: '60000-000' },
    contato: { tipo: 'telefone', valor: '85999999999' }
  };

  it('cria o perfil quando não existe e grava CPF, endereço e contato normalizados', async () => {
    const users = new FakeUsers();
    const enderecos = new FakeEnderecos();
    const contatos = new FakeContatos();
    const service = new UserService(users, enderecos, contatos, new FakeSupabase());

    const resposta = await service.completeRegistration(usuario(id, { email: 'maria@teste.com' }), request);
    expect(resposta).toMatchObject({ id, role: 'Cliente', cpf: '12345678901' });
    expect(enderecos.itens[0]).toMatchObject({ estado: 'CE', cep: '60000000', principal: true });
    expect(contatos.itens[0]).toMatchObject({ tipo: 'telefone', principal: true });
  });

  it('recusa cadastro já finalizado e CPF de outra conta com as mensagens que o front trata', async () => {
    const users = new FakeUsers();
    const service = new UserService(users, new FakeEnderecos(), new FakeContatos(), new FakeSupabase());

    const outro = User.register(randomUUID(), 'Outro', Email.create('outro@teste.com'), UserRole.Cliente);
    outro.completeRegistration('12345678901');
    await users.add(outro);
    await users.add(User.register(id, 'Maria', Email.create('maria@teste.com'), UserRole.Cliente));

    await expect(service.completeRegistration(usuario(id), request)).rejects.toThrow(
      "Já existe um usuário com o CPF '123.456.789-01'."
    );

    users.users.get(id)!.completeRegistration('98765432100');
    const erro = await service.completeRegistration(usuario(id), request).catch(e => e);
    expect(erro).toBeInstanceOf(ConflictException);
    expect(erro.message).toBe('Cadastro já finalizado.');
  });
});
