import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../src/infrastructure/database.js';
import { OportunidadeQueries } from '../src/infrastructure/repositories/oportunidade-queries.js';

describe('Oportunidades: uma consulta por leitura, com snapshot consistente', () => {
  let pg: PGlite;
  let queries = 0;
  let transactions = 0;
  const provider = randomUUID();
  const otherProvider = randomUUID();
  const inactiveProvider = randomUUID();
  const client = randomUUID();
  const ids = Array.from({ length: 9 }, () => randomUUID());
  const photoIds = [randomUUID(), randomUUID()].sort();
  const db: Database = {
    async query<T extends object>(sql: string, params?: unknown[]) {
      queries++;
      return (await pg.query<T>(sql, params)).rows;
    },
    async transaction() {
      transactions++;
      throw new Error('These single-statement reads must not open a transaction');
    },
    async close() { await pg.close(); }
  };
  const repository = new OportunidadeQueries(db);
  const filter = { page: 1, pageSize: 2, category: '', search: '', sort: 'recent' as const };

  beforeAll(async () => {
    pg = await PGlite.create();
    await pg.exec(`
      create table public.users(id uuid primary key,name text not null,role text not null,is_active boolean not null,created_at timestamptz not null default '2026-01-01T12:00:00Z');
      create table public.fornecedores(id_usuario uuid primary key,cidade_atuacao text not null);
      create table public.especialidades(codigo text primary key,nome text not null,is_active boolean not null);
      create table public.fornecedor_especialidades(id_usuario uuid,codigo_especialidade text);
      create table public.pedidos(id uuid primary key,id_cliente uuid,status text not null,escopo jsonb not null,data_criacao timestamptz not null);
      create table public.propostas(id uuid primary key,id_pedido uuid,id_prestador uuid,status text not null);
      create table public.fotos_pedido(id uuid primary key,id_pedido uuid,foto text not null,descricao text);
      insert into public.especialidades values('eletrica','Elétrica',true),('hidraulica','Hidráulica',true),('pintura','Pintura',true),('inativa','Inativa',false);
    `);
    await pg.query(`insert into users(id,name,role,is_active) values
      ($1,'Fornecedor','Prestador',true),($2,'Outro fornecedor','Prestador',true),
      ($3,'Fornecedor inativo','Prestador',false),($4,'Cliente real','Cliente',true)`, [provider, otherProvider, inactiveProvider, client]);
    await pg.query(`insert into fornecedores values($1,'Fortaleza'),($2,'São Paulo'),($3,'Fortaleza')`, [provider, otherProvider, inactiveProvider]);
    await pg.query(`insert into fornecedor_especialidades values($1,'eletrica'),($1,'hidraulica'),($1,'inativa'),($2,'pintura'),($3,'eletrica')`, [provider, otherProvider, inactiveProvider]);
    const categories = ['  ELÉTRICA ', 'eletrica', 'HIDRÁULICA', 'Pintura', 'Elétrica', 'Elétrica', 'Elétrica', 'Elétrica', 'Inativa'];
    for (let index = 0; index < ids.length; index++) {
      await pg.query(`insert into pedidos(id,id_cliente,status,escopo,data_criacao) values($1,$2,$3,$4,$5)`, [
        ids[index], index === 7 ? provider : client, index === 5 ? 'concluido' : 'aberto',
        JSON.stringify({ titulo: index === 0 ? 'Reparo literal %_' : `Pedido ${index}`, categoria: categories[index],
          localizacao: index === 4 ? 'São Paulo, SP' : 'Fortaleza, CE', descricao: ' Descrição real ', detalhes: ' ', especificacoes: 'Instalação elétrica', segredo: 'não expor' }),
        `2026-11-${String(index + 1).padStart(2, '0')}T12:00:00Z`
      ]);
    }
    await pg.query(`insert into propostas values($1,$2,$3,'enviada'),($4,$2,$5,'visualizada'),($6,$7,$5,'escolhida')`,
      [randomUUID(), ids[0], provider, randomUUID(), otherProvider, randomUUID(), ids[6]]);
    await pg.query(`insert into fotos_pedido values($1,$2,'https://example.invalid/a.jpg','Foto real'),($3,$2,'https://example.invalid/b.jpg',null)`, [photoIds[0], ids[0], photoIds[1]]);
    queries = 0;
  });

  afterAll(async () => { await pg?.close(); });

  it('pagina, ordena e filtra os mesmos pedidos elegíveis em uma única consulta', async () => {
    const first = await repository.list(provider, filter);
    expect(queries).toBe(1);
    expect(transactions).toBe(0);
    expect(first).toMatchObject({ page: 1, pageSize: 2, totalItems: 3, totalPages: 2,
      specialties: [{ codigo: 'eletrica', nome: 'Elétrica' }, { codigo: 'hidraulica', nome: 'Hidráulica' }] });
    expect(first.items.map(item => item.id)).toEqual([ids[2], ids[1]]);
    queries = 0;
    const second = await repository.list(provider, { ...filter, page: 2 });
    expect(queries).toBe(1);
    expect(second.items[0]).toMatchObject({ id: ids[0], category: 'Elétrica', proposalsCount: 2,
      createdAt: '2026-11-01T12:00:00.000Z' });
    const category = await repository.list(provider, { ...filter, category: 'hidraulica' });
    expect(category.items.map(item => item.id)).toEqual([ids[2]]);
    const literal = await repository.list(provider, { ...filter, search: '%' });
    expect(literal.items.map(item => item.id)).toEqual([ids[0]]);
    expect((await repository.list(provider, { ...filter, search: "%' or 1=1--" })).totalItems).toBe(0);
    const byProposals = await repository.list(provider, { ...filter, pageSize: 10, sort: 'proposals' });
    expect(byProposals.items.map(item => item.id)).toEqual([ids[2], ids[1], ids[0]]);
  });

  it('preserva o catálogo e o total mesmo em página vazia ou além da última', async () => {
    queries = 0;
    const beyond = await repository.list(provider, { ...filter, page: 3 });
    expect(queries).toBe(1);
    expect(beyond).toMatchObject({ items: [], totalItems: 3, totalPages: 2, page: 3 });
    expect(beyond.specialties).toHaveLength(2);
    const missingCategory = await repository.list(provider, { ...filter, category: 'pintura' });
    expect(missingCategory).toMatchObject({ items: [], totalItems: 0, totalPages: 0 });
    expect(missingCategory.specialties).toHaveLength(2);
    expect(await repository.list(inactiveProvider, filter)).toMatchObject({ items: [], totalItems: 0, specialties: [] });
    expect(await repository.list(randomUUID(), filter)).toMatchObject({ items: [], totalItems: 0, specialties: [] });
  });

  it('carrega detalhe, fotos e histórico do cliente juntos e mantém a elegibilidade', async () => {
    queries = 0;
    const detail = await repository.getById(ids[0]!, provider);
    expect(queries).toBe(1);
    expect(transactions).toBe(0);
    expect(detail).toMatchObject({ id: ids[0], description: 'Descrição real', details: undefined,
      specifications: 'Instalação elétrica', proposalsCount: 2,
      client: { name: 'Cliente real', memberSince: '2026-01-01T12:00:00.000Z', ordersCount: 8, completedOrdersCount: 1 } });
    expect(detail?.photos).toEqual([
      { id: photoIds[0], url: 'https://example.invalid/a.jpg', description: 'Foto real' },
      { id: photoIds[1], url: 'https://example.invalid/b.jpg', description: undefined }
    ]);
    expect(detail).not.toHaveProperty('escopo');
    expect(JSON.stringify(detail)).not.toContain('não expor');
    expect((await repository.getById(ids[1]!, provider))?.photos).toEqual([]);
    for (const order of ids.slice(3)) expect(await repository.getById(order, provider)).toBeNull();
    expect(await repository.getById(ids[0]!, otherProvider)).toBeNull();
    expect(await repository.getById(ids[0]!, inactiveProvider)).toBeNull();
    expect(await repository.getById(randomUUID(), provider)).toBeNull();
  });
});
