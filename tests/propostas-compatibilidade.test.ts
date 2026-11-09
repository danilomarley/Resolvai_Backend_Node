import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite, type Transaction } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { criarPropostaSchema, propostaEnviadaSchema } from '../src/application/dtos/propostas-fornecedor.js';
import { ConflictException, NotFoundException } from '../src/application/errors.js';
import { PropostaPrestadorService } from '../src/application/services/proposta-prestador-service.js';
import { Contato } from '../src/domain/contato.js';
import { Email } from '../src/domain/email.js';
import { Fornecedor } from '../src/domain/fornecedor.js';
import { User } from '../src/domain/user.js';
import { DomainException } from '../src/domain/errors.js';
import type { Database, Sql } from '../src/infrastructure/database.js';
import { FornecedorRepository } from '../src/infrastructure/repositories/fornecedor-repository.js';
import { PropostaFornecedorRepository } from '../src/infrastructure/repositories/proposta-fornecedor-repository.js';
import { PropostaPrestadorRepository } from '../src/infrastructure/repositories/proposta-prestador-repository.js';
import { PropostaRepository } from '../src/infrastructure/repositories/proposta-repository.js';
import { caminhosDoPortfolio } from '../src/infrastructure/repositories/proposta-portfolio.js';

describe('Compatibilidade entre propostas do cliente, fornecedor e prestador', () => {
  let pg: PGlite;
  let database: Database;
  let fornecedores: PropostaFornecedorRepository;
  let prestadores: PropostaPrestadorRepository;
  let clientes: PropostaRepository;
  const customerId = randomUUID();
  const pf = randomUUID();
  const pj = randomUUID();
  const legacy = randomUUID();

  beforeAll(async () => {
    pg = await PGlite.create({ extensions: { citext, pgcrypto }, parsers: { 20: Number, 1700: Number } });
    const executor = (connection: Pick<PGlite | Transaction, 'query'>): Sql => ({
      query: async <T extends object>(text: string, params?: unknown[]) => (await connection.query<T>(text, params)).rows
    });
    database = {
      ...executor(pg),
      transaction: callback => pg.transaction(tx => callback(executor(tx))),
      close: () => pg.close()
    };
    await pg.exec(`create role anon; create role authenticated; create schema storage;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
    const scripts = join(import.meta.dirname, '..', 'db', 'scripts');
    for (const name of readdirSync(scripts).filter(name => name.endsWith('.sql')).sort()) {
      await pg.exec(readFileSync(join(scripts, name), 'utf8'));
    }
    await database.query("insert into users(id,name,email,role) values($1,'Cliente','cross-customer@example.invalid','Cliente')", [customerId]);
    const profiles = new FornecedorRepository(database);
    for (const [id, type] of [[pf, 'PF'], [pj, 'PJ'], [legacy, 'PF']] as const) {
      const user = User.register(id, `Fornecedor ${type}`, Email.create(`${id}@example.invalid`), 'Prestador');
      if (type === 'PF') user.completeRegistration(id === legacy ? '11144477735' : '52998224725');
      const profile = Fornecedor.register(id, type, type === 'PJ' ? '11222333000181' : null, {
        nomeExibicao: user.name, cidadeAtuacao: 'Fortaleza', ufAtuacao: 'CE', raioAtendimentoKm: 20
      });
      await profiles.addComplete(user, profile, Contato.register(id, 'whatsapp', '85999990000', true), ['eletrica']);
    }
    fornecedores = new PropostaFornecedorRepository(database);
    prestadores = new PropostaPrestadorRepository(database);
    clientes = new PropostaRepository(database);
  });

  afterAll(async () => { await database?.close(); });

  const order = async (patch: { owner?: string; category?: string; city?: string; status?: string } = {}) => {
    const id = randomUUID();
    await database.query('insert into pedidos(id,id_cliente,escopo,status) values($1,$2,$3::jsonb,$4)', [
      id, patch.owner ?? customerId,
      JSON.stringify({ titulo: 'Reparo elétrico', categoria: patch.category ?? 'Elétrica', localizacao: patch.city ?? 'Fortaleza/CE' }),
      patch.status ?? 'aberto'
    ]);
    return id;
  };
  const multipart = (deadline = '3 dias') => criarPropostaSchema.parse({
    requestId: randomUUID(), valueCents: 12345, deadline,
    description: 'Inspeção e reparo completo do circuito elétrico.', guaranteePeriod: '90 dias', guaranteeType: 'Reexecução gratuita'
  });
  const json = { value: 150, deadlineDays: 5, description: 'Reparo completo no circuito', warranty: '90 dias de garantia' };

  it('preserva prazo numérico, visualização e NotChosen no fluxo fornecedor → cliente', async () => {
    const orderId = await order();
    const data = multipart();
    const first = await fornecedores.create(orderId, pf, data, 'first', []);
    expect((await clientes.list(orderId, customerId, 'deadline', 'asc'))?.[0]).toMatchObject({ id: data.requestId, deadlineDays: 3 });
    await clientes.markViewed(orderId, data.requestId, customerId);
    expect((await fornecedores.find(data.requestId))?.proposal.status).toBe('Viewed');
    const chosen = await fornecedores.create(orderId, pj, multipart('1 dia'), 'chosen', []);
    expect(await clientes.accept(orderId, chosen.proposal.id, customerId)).toBe('ok');
    const notChosen = (await fornecedores.find(first.proposal.id))!.proposal;
    expect(propostaEnviadaSchema.parse(notChosen).status).toBe('NotChosen');
  });

  it('repete o mesmo envio e rejeita outro requestId para o mesmo pedido/prestador', async () => {
    const orderId = await order();
    const data = multipart();
    await fornecedores.create(orderId, pf, data, 'same', []);
    expect((await fornecedores.create(orderId, pf, data, 'same', [])).created).toBe(false);
    await expect(fornecedores.create(orderId, pf, multipart(), 'different', [])).rejects.toBeInstanceOf(ConflictException);
    await expect(fornecedores.assertAvailable(orderId, pf)).rejects.toBeInstanceOf(ConflictException);
    expect(await prestadores.create(orderId, pf, json)).toBe('duplicate');
  });

  it('aceita PJ sem CPF e PF com perfil canônico completo pela API JSON', async () => {
    expect(await prestadores.create(await order(), pj, json)).toMatchObject({ status: 'Sent', value: 150 });
    expect(await prestadores.create(await order(), legacy, json)).toMatchObject({ status: 'Sent' });
  });

  it('mantém erro de cadastro incompleto separado de incompatibilidade do pedido', async () => {
    const incomplete = randomUUID();
    const orderId = await order();
    await database.query("insert into users(id,name,email,role) values($1,'Incompleto',$2,'Prestador')", [incomplete, `${incomplete}@example.invalid`]);
    expect(await prestadores.create(orderId, incomplete, json)).toBe('incomplete');
    const service = new PropostaPrestadorService(prestadores, {
      getCurrent: async () => { throw new NotFoundException('Fornecedor', incomplete); }
    });
    const error = await service.criar({ isAuthenticated: true, id: incomplete }, orderId, json).catch(error => error);
    expect(error).toBeInstanceOf(DomainException);
    expect(error.message).toBe('Finalize o cadastro antes de enviar uma proposta.');
    await expect(fornecedores.create(orderId, incomplete, multipart(), 'incomplete', [])).rejects.toBeInstanceOf(NotFoundException);
  });

  it('aplica especialidade, cidade, pedido próprio e estado aberto nas duas APIs', async () => {
    for (const patch of [{ category: 'Pintura' }, { city: 'Recife/PE' }, { owner: pf }, { status: 'concluido' }]) {
      const orderId = await order(patch);
      await expect(fornecedores.create(orderId, pf, multipart(), randomUUID(), [])).rejects.toBeInstanceOf(NotFoundException);
      expect(await prestadores.create(orderId, pf, json)).toBe(patch.status ? 'closed' : 'notFound');
    }
    const orderId = await order();
    await database.query("update fornecedores set cidade_atuacao='Recife' where id_usuario=$1", [legacy]);
    expect(await prestadores.create(orderId, legacy, json)).toBe('notFound');
  });

  it('lê propostas legadas e substitui garantia estruturada sem devolver valores antigos', async () => {
    const legacyProposal = await prestadores.create(await order(), pj, json);
    expect(typeof legacyProposal).toBe('object');
    if (typeof legacyProposal !== 'object') throw new Error('Proposal not created');
    const read = (await fornecedores.find(legacyProposal.id))!.proposal;
    expect(propostaEnviadaSchema.parse(read).warranty).toEqual({ text: json.warranty });
    const orderId = await order();
    const data = multipart();
    await fornecedores.create(orderId, pf, data, 'original', []);
    await prestadores.update(data.requestId, pf, { warranty: 'Garantia substituída em texto livre' });
    expect((await fornecedores.find(data.requestId))!).toMatchObject({ payloadHash: null, proposal: { warranty: { text: 'Garantia substituída em texto livre' } } });
    expect(propostaEnviadaSchema.parse((await fornecedores.find(data.requestId))!.proposal).warranty.period).toBeUndefined();
    await expect(fornecedores.create(orderId, pf, data, 'original', [])).rejects.toBeInstanceOf(ConflictException);
  });

  it('retira a proposta com limpeza pós-COMMIT apenas das suas fotos', async () => {
    const orderId = await order();
    const data = multipart();
    const path = `propostas/${pf}/${data.requestId}/${randomUUID()}/0.png`;
    await fornecedores.create(orderId, pf, data, 'photo', [{ url: `https://storage.invalid/storage/v1/object/public/pedidos/${path}`, name: 'foto.png' }]);
    const storage = { remover: vi.fn(async (_paths: string[]) => {}) };
    const service = new PropostaPrestadorService(prestadores, { getCurrent: vi.fn() }, storage);
    await service.retirar({ isAuthenticated: true, id: pf }, data.requestId);
    expect(await fornecedores.find(data.requestId)).toBeNull();
    expect(storage.remover).toHaveBeenCalledWith([path]);
    expect(caminhosDoPortfolio([
      { url: `https://storage.invalid/${path}` },
      { url: `https://storage.invalid/propostas/${pj}/${data.requestId}/${randomUUID()}/0.png` },
      { url: `https://storage.invalid/propostas/${pf}/${data.requestId}/../foreign.png` }
    ], pf, data.requestId)).toEqual([path]);
  });

  it('preserva as fotos quando não é possível confirmar o COMMIT da retirada', async () => {
    const orderId = await order();
    const data = multipart();
    const path = `propostas/${pf}/${data.requestId}/${randomUUID()}/0.png`;
    await fornecedores.create(orderId, pf, data, 'uncertain-delete', [{ url: `https://storage.invalid/${path}`, name: 'foto.png' }]);
    const uncertainDatabase: Database = {
      ...database,
      transaction: async callback => {
        await database.transaction(callback);
        throw new Error('Connection lost after COMMIT');
      }
    };
    const storage = { remover: vi.fn(async (_paths: string[]) => {}) };
    const service = new PropostaPrestadorService(new PropostaPrestadorRepository(uncertainDatabase), { getCurrent: vi.fn() }, storage);
    await expect(service.retirar({ isAuthenticated: true, id: pf }, data.requestId)).rejects.toThrow('Connection lost after COMMIT');
    expect(storage.remover).not.toHaveBeenCalled();
  });
});
