import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { buildApp } from '../src/api/app.js';
import { criarDependencias } from '../src/composicao.js';
import { loadConfig } from '../src/config/env.js';
import { AuthService } from '../src/application/services/auth-service.js';
import { atualizarPerfilPrestadorSchema } from '../src/application/dtos/prestador.js';
import { atualizarFornecedorRequestSchema } from '../src/application/dtos/fornecedores.js';
import { FakeSupabase } from './fakes.js';
import { ConflictException, ForbiddenException, UnauthorizedException } from '../src/application/errors.js';
import { PrestadorService } from '../src/application/services/prestador-service.js';
import { FornecedorService } from '../src/application/services/fornecedor-service.js';
import { Contato } from '../src/domain/contato.js';
import { Email } from '../src/domain/email.js';
import { UserRole } from '../src/domain/enums.js';
import { Fornecedor } from '../src/domain/fornecedor.js';
import { User } from '../src/domain/user.js';
import type { Database, Sql } from '../src/infrastructure/database.js';
import { FornecedorRepository } from '../src/infrastructure/repositories/fornecedor-repository.js';
import { EspecialidadeQueries } from '../src/infrastructure/repositories/especialidade-queries.js';
import { OportunidadeQueries } from '../src/infrastructure/repositories/oportunidade-queries.js';
import { PrestadorRepository } from '../src/infrastructure/repositories/prestador-repository.js';
import { UserRepository } from '../src/infrastructure/repositories/user-repository.js';

const root = join(import.meta.dirname, '..');
const migration = readFileSync(join(root, 'supabase/migrations/20261109014627_reconcile_fornecedor_prestador.sql'), 'utf8');
const prScripts = new Set(['013_create_fornecedores.sql', '014_create_especialidades_fornecedor.sql', '015_users_cpf_por_papel.sql', '016_expand_propostas_form.sql']);

async function banco(mode: 'pr' | 'combined') {
  const pg = await PGlite.create({ extensions: { citext, pgcrypto } });
  await pg.exec(`create role anon; create role authenticated; create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
  const scripts = join(root, 'db/scripts');
  for (const file of readdirSync(scripts).filter(name => name.endsWith('.sql')).sort()) {
    if (mode === 'combined' || Number(file.slice(0, 3)) <= 12 || prScripts.has(file)) {
      await pg.exec(readFileSync(join(scripts, file), 'utf8'));
    }
  }
  return pg;
}

function executor(pg: PGlite): Database {
  const sql: Sql = {
    async query<T extends object>(query: string, params?: unknown[]) {
      return (await pg.query<T>(query, params)).rows;
    }
  };
  return {
    ...sql,
    async transaction<T>(callback: (connection: Sql) => Promise<T>) {
      await pg.exec('begin');
      try {
        const result = await callback(sql);
        await pg.exec('commit');
        return result;
      } catch (error) {
        await pg.exec('rollback');
        throw error;
      }
    },
    close: () => pg.close()
  };
}

describe('Perfil canônico nas tabelas existentes de fornecedor', () => {
  it('atualiza o schema já usado pelo PR, preserva dados e pode ser repetida', async () => {
    const pg = await banco('pr');
    try {
      const fornecedor = randomUUID();
      const cliente = randomUUID();
      const pedido = randomUUID();
      const proposta = randomUUID();
      await pg.query(`insert into users(id,name,email,role,cpf) values
        ($1,'Fornecedor','fornecedor@teste.com','Prestador','52998224725'),
        ($2,'Cliente','cliente@teste.com','Cliente',null)`, [fornecedor, cliente]);
      await pg.query(`insert into fornecedores(id_usuario,tipo_pessoa,nome_exibicao,cidade_atuacao,uf_atuacao)
        values($1,'PF','Profissional','Fortaleza','CE')`, [fornecedor]);
      await pg.query('insert into fornecedor_especialidades(id_usuario,codigo_especialidade) values($1,\'eletrica\')', [fornecedor]);
      await pg.query('insert into pedidos(id,id_cliente,status) values($1,$2,\'aberto\')', [pedido, cliente]);
      await pg.query(`insert into propostas(id,id_pedido,id_prestador,valor,prazo,portfolio)
        values($1,$2,$3,125.50,'5 dias','[{"url":"https://example.com/original.jpg","name":"original.jpg"}]')`, [proposta, pedido, fornecedor]);

      await pg.exec(migration);
      await pg.exec(migration);
      for (const table of ['categorias_servico', 'prestador_categorias', 'prestador_regioes']) {
        expect((await pg.query('select to_regclass($1) as name', [`public.${table}`])).rows[0]).toEqual({ name: null });
      }

      const proposal = (await pg.query('select valor,prazo_dias,portfolio from propostas where id=$1', [proposta])).rows[0];
      expect(proposal).toMatchObject({ prazo_dias: 5, portfolio: [{ url: 'https://example.com/original.jpg', name: 'original.jpg' }] });
      const profile = await new PrestadorRepository(executor(pg)).getPerfil(fornecedor);
      expect(profile.categories.map(item => item.slug)).toEqual(['eletrica']);
      expect(profile.cities).toEqual(['Fortaleza']);
      expect((await pg.query('select id_usuario from fornecedores where id_usuario=$1', [fornecedor])).rows).toHaveLength(1);
      await pg.query('update propostas set status=\'nao_escolhida\' where id=$1', [proposta]);
    } finally { await pg.close(); }
  });

  it('login, perfil, catálogo e oportunidades funcionam no schema atual, sem aplicar a migração pendente', async () => {
    const pg = await banco('pr');
    try {
      const db = executor(pg);
      const id = randomUUID();
      const email = 'login-canonico@example.invalid';
      const user = User.register(id, 'Profissional', Email.create(email), UserRole.Prestador);
      user.completeRegistration('52998224725');
      const fornecedores = new FornecedorRepository(db);
      await fornecedores.addComplete(user, Fornecedor.register(id, 'PF', undefined, {
        nomeExibicao: 'Profissional', cidadeAtuacao: 'Fortaleza', ufAtuacao: 'CE', raioAtendimentoKm: 20
      }), Contato.register(id, 'whatsapp', '85999999999', true), ['eletrica']);
      const config = loadConfig({ DATABASE_URL: 'postgresql://synthetic.invalid/test', SUPABASE_URL: 'https://auth.example.invalid',
        SUPABASE_ANON_KEY: 'synthetic-public', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-private', SUPABASE_JWT_SECRET: 'synthetic-local-test-secret' });
      const token = await new SignJWT({ email }).setProtectedHeader({ alg: 'HS256' }).setSubject(id)
        .setIssuer(config.supabase.authIssuer).setAudience('authenticated').setExpirationTime('5m')
        .sign(new TextEncoder().encode(config.supabase.jwtSecret));
      const auth = new FakeSupabase();
      auth.session = { accessToken: token, tokenType: 'Bearer', expiresAtUtc: new Date(Date.now() + 300_000), refreshToken: 'synthetic-refresh', user: { id, email } };
      const dependencias = criarDependencias(config, db);
      dependencias.authService = new AuthService(dependencias.userRepository, auth, fornecedores);
      const app = await buildApp({ dependencias });
      try {
        const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login-provider', payload: { email, password: 'Synthetic123!' } });
        expect(login.statusCode, login.body).toBe(200);
        const headers = { authorization: `Bearer ${login.json().accessToken}` };
        const profile = await app.inject({ method: 'GET', url: '/api/v1/fornecedores/me', headers });
        expect(profile.statusCode, profile.body).toBe(200);
        expect(profile.json()).toMatchObject({ idUsuario: id, especialidades: ['eletrica'], cidadeAtuacao: 'Fortaleza', cidadesAtuacao: ['Fortaleza'] });
        for (const url of ['/api/v1/especialidades', '/api/v1/catalog/categories', '/api/v1/provider/profile', '/api/v1/provider/orders', '/api/v1/fornecedores/me/oportunidades']) {
          const response = await app.inject({ method: 'GET', url, headers });
          expect(response.statusCode, `${url}: ${response.body}`).toBe(200);
        }
      } finally { await app.close(); }
      for (const table of ['categorias_servico', 'prestador_categorias', 'prestador_regioes', 'avaliacoes']) {
        expect((await pg.query('select to_regclass($1) as name', [`public.${table}`])).rows[0]).toEqual({ name: null });
      }
    } finally { await pg.close(); }
  });

  it('reconhece PJ sem CPF e usa os mesmos vínculos e cidade principal nas duas APIs', async () => {
    const pg = await banco('combined');
    try {
      await pg.exec(migration);
      const db = executor(pg);
      const fornecedores = new FornecedorRepository(db);
      const prestadores = new PrestadorRepository(db);
      const users = new UserRepository(db);
      const id = randomUUID();
      const cliente = randomUUID();
      const user = User.register(id, 'Empresa', Email.create('empresa@teste.com'), UserRole.Prestador);
      const dados = { nomeExibicao: 'Empresa', cidadeAtuacao: 'Fortaleza', cidadesAtuacao: ['fortaleza '], ufAtuacao: 'CE', raioAtendimentoKm: 20 };
      await fornecedores.addComplete(user, Fornecedor.register(id, 'PJ', '11.222.333/0001-81', dados), Contato.register(id, 'whatsapp', '85999999999', true), ['eletrica']);
      const service = new PrestadorService(prestadores, users, fornecedores);
      expect(await service.perfil({ isAuthenticated: true, id })).toMatchObject({ registrationComplete: true, onboardingComplete: true, cities: ['Fortaleza'] });
      expect((await fornecedores.getByUsuarioId(id))?.cidadesAtuacao).toEqual(['Fortaleza']);

      const categories = await prestadores.listCategorias();
      const pintura = categories.find(item => item.slug === 'pintura')!;
      expect(pintura.id).toBe('pintura');
      expect(await prestadores.savePerfil(id, [pintura.id], ['Recife'])).toBe('ok');
      expect(await fornecedores.getByUsuarioId(id)).toMatchObject({ especialidades: ['pintura'], cidadeAtuacao: 'Recife', cidadesAtuacao: ['Recife'] });

      const fornecedorService = new FornecedorService(users, fornecedores, new EspecialidadeQueries(db), {} as never);
      await fornecedorService.updateCurrent({ isAuthenticated: true, id }, {
        name: 'Empresa', nomeExibicao: 'Empresa', telefone: '85999999999', cidadeAtuacao: 'Fortaleza',
        ufAtuacao: 'CE', raioAtendimentoKm: 20, especialidades: ['eletrica']
      });
      expect((await fornecedores.getByUsuarioId(id))?.cidadesAtuacao).toEqual(['Fortaleza']);

      await fornecedores.updateComplete(user, Fornecedor.register(id, 'PJ', '11.222.333/0001-81', dados), Contato.register(id, 'whatsapp', '85999999999', true), ['eletrica']);
      expect((await prestadores.getPerfil(id)).categories.map(item => item.slug)).toEqual(['eletrica']);
      await pg.query("insert into users(id,name,email,role) values($1,'Cliente','pedido@teste.com','Cliente')", [cliente]);
      for (const [localizacao, categoria, dono] of [['Fortaleza/CE', '  ELÉTRICA  ', cliente], ['Caucaia/CE', 'Elétrica', cliente], ['Recife/PE', 'Elétrica', cliente], ['Fortaleza/CE', 'Pintura', cliente], ['Fortaleza/CE', 'Elétrica', id]]) {
        await pg.query('insert into pedidos(id,id_cliente,escopo) values($1,$2,$3::jsonb)', [randomUUID(), dono, JSON.stringify({ categoria, localizacao })]);
      }
      const opportunities = await new OportunidadeQueries(db).list(id, { page: 1, pageSize: 10, category: '', search: '', sort: 'recent' });
      expect(opportunities.totalItems).toBe(1);
    } finally { await pg.close(); }
  });

  it('completa contas legadas PF/PJ sem recriar usuário, credenciais ou documento existente', async () => {
    const pg = await banco('combined');
    try {
      await pg.exec(migration);
      const db = executor(pg);
      const users = new UserRepository(db);
      const fornecedores = new FornecedorRepository(db);
      const service = new FornecedorService(users, fornecedores, new EspecialidadeQueries(db), {} as never);
      const documentos = [
        { tipoPessoa: 'PF' as const, cpfExistente: '52998224725', cpf: undefined, cnpj: undefined },
        { tipoPessoa: 'PF' as const, cpfExistente: null, cpf: '11144477735', cnpj: undefined },
        { tipoPessoa: 'PJ' as const, cpfExistente: null, cpf: undefined, cnpj: '11.222.333/0001-81' }
      ];
      for (const [index, documento] of documentos.entries()) {
        const id = randomUUID();
        const email = `legado-${index}@teste.com`;
        await pg.query("insert into users(id,name,email,role,cpf,created_at) values($1,'Legado',$2,'Prestador',$3,'2000-01-01T00:00:00Z')", [id, email, documento.cpfExistente]);
        await pg.query("insert into contatos(id_usuario,tipo,valor,principal) values($1,'whatsapp','85911111111',true)", [id]);
        const profile = await service.completeCurrent({ isAuthenticated: true, id }, {
          name: 'Nome atualizado', nomeExibicao: 'Profissional', tipoPessoa: documento.tipoPessoa, cpf: documento.cpf, cnpj: documento.cnpj, telefone: '85999999999',
          cidadeAtuacao: 'Fortaleza', cidadesAtuacao: ['Fortaleza'], ufAtuacao: 'CE',
          raioAtendimentoKm: 20, especialidades: ['eletrica']
        });
        expect(profile).toMatchObject({ idUsuario: id, email, tipoPessoa: documento.tipoPessoa, cidadesAtuacao: ['Fortaleza'] });
        const user = await users.getById(id);
        expect(user).toMatchObject({ id, role: UserRole.Prestador, cpf: documento.cpfExistente ?? documento.cpf ?? null });
        expect(user?.email.value).toBe(email);
        expect(user?.createdAt.toISOString()).toBe('2000-01-01T00:00:00.000Z');
        expect((await pg.query('select id from contatos where id_usuario=$1', [id])).rows).toHaveLength(1);
        expect((await new PrestadorService(new PrestadorRepository(db), users, fornecedores).perfil({ isAuthenticated: true, id })).onboardingComplete).toBe(true);
      }
      expect((await pg.query('select id from users')).rows).toHaveLength(3);
    } finally { await pg.close(); }
  });

  it('recusa várias cidades e especialidade inválida sem perder a cidade ou os vínculos atuais', async () => {
    const pg = await banco('pr');
    try {
      const db = executor(pg);
      const users = new UserRepository(db);
      const fornecedores = new FornecedorRepository(db);
      const prestadores = new PrestadorRepository(db);
      const id = randomUUID();
      const user = User.register(id, 'Profissional', Email.create('single-city@example.invalid'), UserRole.Prestador);
      user.completeRegistration('52998224725');
      const dados = { nomeExibicao: 'Profissional', cidadeAtuacao: 'Fortaleza', ufAtuacao: 'CE', raioAtendimentoKm: 20 };
      await fornecedores.addComplete(user, Fornecedor.register(id, 'PF', undefined, dados), Contato.register(id, 'whatsapp', '85999999999', true), ['eletrica']);
      const body = { ...dados, name: user.name, telefone: '85999999999', especialidades: ['pintura'] };
      expect(atualizarFornecedorRequestSchema.safeParse({ ...body, cidadesAtuacao: ['Fortaleza', 'Caucaia'] }).success).toBe(false);
      expect(atualizarPerfilPrestadorSchema.safeParse({ categoryIds: ['pintura'], cities: ['Fortaleza', 'Caucaia'] }).success).toBe(false);
      const service = new FornecedorService(users, fornecedores, new EspecialidadeQueries(db), {} as never);
      await expect(service.updateCurrent({ isAuthenticated: true, id }, { ...body, cidadesAtuacao: ['Fortaleza', 'Caucaia'] })).rejects.toThrow('somente a cidade principal');
      await expect(service.updateCurrent({ isAuthenticated: true, id }, { ...body, cidadesAtuacao: ['Recife'] })).rejects.toThrow('somente a cidade principal');
      expect(await prestadores.savePerfil(id, ['nao_existe'], ['Recife'])).toBe('invalidCategory');
      await pg.query("update especialidades set is_active=false where codigo='pintura'");
      expect(await prestadores.savePerfil(id, ['pintura'], ['Recife'])).toBe('invalidCategory');
      expect(await fornecedores.getByUsuarioId(id)).toMatchObject({ cidadeAtuacao: 'Fortaleza', cidadesAtuacao: ['Fortaleza'], especialidades: ['eletrica'] });
      const legacy = User.register(randomUUID(), 'Legado', Email.create('legacy-profile@example.invalid'), UserRole.Prestador);
      legacy.completeRegistration('11144477735');
      await users.add(legacy);
      expect(await prestadores.savePerfil(legacy.id, ['eletrica'], ['Fortaleza'])).toBe('incomplete');
      expect(await new PrestadorService(prestadores, users, fornecedores).perfil({ isAuthenticated: true, id: legacy.id }))
        .toMatchObject({ categories: [], cities: [], registrationComplete: false, onboardingComplete: false });
    } finally { await pg.close(); }
  });

  it('recusa completar sem autenticação, com outro papel, documento divergente ou perfil duplicado', async () => {
    const pg = await banco('combined');
    try {
      await pg.exec(migration);
      const db = executor(pg);
      const users = new UserRepository(db);
      const fornecedores = new FornecedorRepository(db);
      const service = new FornecedorService(users, fornecedores, new EspecialidadeQueries(db), {} as never);
      const id = randomUUID();
      const cliente = randomUUID();
      const inativo = randomUUID();
      await pg.query(`insert into users(id,name,email,role,cpf,is_active) values
        ($1,'Legado','legado@teste.com','Prestador','52998224725',true),
        ($2,'Admin','cliente@teste.com','Admin',null,true),
        ($3,'Inativo','inativo@teste.com','Prestador',null,false)`, [id, cliente, inativo]);
      const data = { name: 'Profissional', nomeExibicao: 'Profissional', tipoPessoa: 'PF' as const,
        telefone: '85999999999', cidadeAtuacao: 'Fortaleza', ufAtuacao: 'CE', raioAtendimentoKm: 20, especialidades: ['eletrica'] };
      await expect(service.completeCurrent({ isAuthenticated: false }, data)).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(service.completeCurrent({ isAuthenticated: true, id: randomUUID() }, data)).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(service.completeCurrent({ isAuthenticated: true, id: cliente }, data)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.completeCurrent({ isAuthenticated: true, id: inativo }, data)).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(service.completeCurrent({ isAuthenticated: true, id }, { ...data, cpf: '11144477735' })).rejects.toBeInstanceOf(ConflictException);
      await expect(service.completeCurrent({ isAuthenticated: true, id }, { ...data, tipoPessoa: 'PJ', cpf: '52998224725', cnpj: '11.222.333/0001-81' })).rejects.toThrow('Pessoa jurídica não pode informar CPF');

      // Revalidate the persisted document under the transaction lock, even if an out-of-date service sent a replacement.
      const changed = User.restore(id, 'Outro', Email.create('novo@teste.com'), UserRole.Prestador, true, new Date(), null, '11144477735');
      await expect(fornecedores.completeExisting(changed, Fornecedor.register(id, 'PF', undefined, data), Contato.register(id, 'whatsapp', data.telefone, true), ['eletrica'])).rejects.toBeInstanceOf(ConflictException);
      expect((await pg.query('select id_usuario from fornecedores')).rows).toHaveLength(0);
      await service.completeCurrent({ isAuthenticated: true, id }, data);
      await expect(service.completeCurrent({ isAuthenticated: true, id }, data)).rejects.toBeInstanceOf(ConflictException);
      expect((await users.getById(id))?.cpf).toBe('52998224725');
    } finally { await pg.close(); }
  });

});
