import type { IFornecedorRepository } from '../../application/contracts.js';
import type { FornecedorResponse } from '../../application/dtos/fornecedores.js';
import { ConflictException, ForbiddenException, NotFoundException, UnauthorizedException } from '../../application/errors.js';
import type { Contato } from '../../domain/contato.js';
import { UserRole } from '../../domain/enums.js';
import { DomainException } from '../../domain/errors.js';
import type { Fornecedor } from '../../domain/fornecedor.js';
import { normalizarTelefone } from '../../domain/telefone.js';
import type { User } from '../../domain/user.js';
import type { Database, Sql } from '../database.js';
import { ContatoRepository } from './contato-repository.js';
import { UserRepository } from './user-repository.js';

type ProfileRow = Omit<FornecedorResponse, 'cpf' | 'createdAt' | 'updatedAt'> & { cpf: string | null; createdAt: Date; updatedAt: Date | null };

export class FornecedorRepository implements IFornecedorRepository {
  constructor(private readonly database: Database) {}

  async existsByCnpj(cnpj: string): Promise<boolean> {
    const [row] = await this.database.query<{ existe: boolean }>('select exists(select 1 from fornecedores where cnpj=$1) as existe', [cnpj]);
    return row?.existe ?? false;
  }

  async getByUsuarioId(id: string): Promise<FornecedorResponse | null> {
    const [row] = await this.database.query<ProfileRow>(`
      select f.id_usuario as "idUsuario", f.tipo_pessoa as "tipoPessoa", f.nome_exibicao as "nomeExibicao", f.cnpj, f.bio,
             f.cidade_atuacao as "cidadeAtuacao", f.uf_atuacao as "ufAtuacao", f.raio_atendimento_km as "raioAtendimentoKm",
             f.registro_profissional as "registroProfissional", f.created_at as "createdAt", f.updated_at as "updatedAt",
             u.name, u.email, u.cpf,
             coalesce((select valor from contatos where id_usuario=f.id_usuario and principal=true
               and tipo in ('telefone','whatsapp') order by id limit 1), '') as telefone,
             array(select cidade from public.prestador_regioes where id_prestador=f.id_usuario order by cidade) as "cidadesAtuacao",
             array(select codigo_especialidade from fornecedor_especialidades where id_usuario=f.id_usuario order by codigo_especialidade) as especialidades
        from fornecedores f join users u on u.id=f.id_usuario where f.id_usuario=$1`, [id]);
    return row ? { ...row, cpf: row.cpf ?? undefined, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt?.toISOString() ?? null } : null;
  }

  async addComplete(user: User, fornecedor: Fornecedor, contato: Contato, especialidades: string[]): Promise<void> {
    this.validate(user, fornecedor, contato, especialidades);
    await this.translateConflict(() => this.database.transaction(async sql => {
      await this.lockEspecialidades(sql, especialidades);
      await new UserRepository(sql).add(user);
      const d = fornecedor.dados;
      await sql.query(`insert into fornecedores
        (id_usuario,tipo_pessoa,nome_exibicao,cnpj,bio,cidade_atuacao,uf_atuacao,raio_atendimento_km,registro_profissional)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [user.id, fornecedor.tipoPessoa, d.nomeExibicao, fornecedor.cnpj, d.bio, d.cidadeAtuacao, d.ufAtuacao, d.raioAtendimentoKm, d.registroProfissional]);
      await new ContatoRepository(sql).add(contato);
      await this.insertEspecialidades(sql, user.id, especialidades);
      await this.syncPrestador(sql, user.id, especialidades, d.cidadesAtuacao ?? [d.cidadeAtuacao]);
    }));
  }

  async updateComplete(user: User, fornecedor: Fornecedor, contato: Contato, especialidades: string[]): Promise<void> {
    this.validate(user, fornecedor, contato, especialidades);
    await this.translateConflict(() => this.database.transaction(async sql => {
      const [atual] = await sql.query<{ role: string; is_active: boolean }>('select role,is_active from users where id=$1 for update', [user.id]);
      if (!atual || !atual.is_active) throw new UnauthorizedException();
      if (atual.role !== UserRole.Prestador) throw new ForbiddenException();
      await this.lockEspecialidades(sql, especialidades);
      // Update only editable fields, preserving documents, email and role.
      await sql.query('update users set name=$2, updated_at=now() where id=$1', [user.id, user.name]);
      const d = fornecedor.dados;
      const updated = await sql.query(`update fornecedores set nome_exibicao=$2,bio=$3,cidade_atuacao=$4,
        uf_atuacao=$5,raio_atendimento_km=$6,registro_profissional=$7,updated_at=now() where id_usuario=$1 returning id_usuario`,
      [user.id, d.nomeExibicao, d.bio, d.cidadeAtuacao, d.ufAtuacao, d.raioAtendimentoKm, d.registroProfissional]);
      if (!updated.length) throw new NotFoundException('Fornecedor', user.id);
      await this.saveContato(sql, contato);
      await sql.query('delete from fornecedor_especialidades where id_usuario=$1', [user.id]);
      await this.insertEspecialidades(sql, user.id, especialidades);
      await this.syncPrestador(sql, user.id, especialidades, d.cidadesAtuacao ?? [d.cidadeAtuacao]);
    }));
  }

  async completeExisting(user: User, fornecedor: Fornecedor, contato: Contato, especialidades: string[]): Promise<void> {
    this.validate(user, fornecedor, contato, especialidades);
    await this.translateConflict(() => this.database.transaction(async sql => {
      const [atual] = await sql.query<{ role: string; is_active: boolean; cpf: string | null }>(
        'select role,is_active,cpf from public.users where id=$1 for update', [user.id]);
      if (!atual || !atual.is_active) throw new UnauthorizedException();
      if (atual.role !== UserRole.Prestador) throw new ForbiddenException();
      if (atual.cpf && atual.cpf !== user.cpf) throw new ConflictException('O CPF já cadastrado não pode ser alterado.');
      if ((await sql.query('select id_usuario from public.fornecedores where id_usuario=$1', [user.id])).length) {
        throw new ConflictException('Perfil profissional já cadastrado.');
      }
      await this.lockEspecialidades(sql, especialidades);
      await sql.query('update public.users set name=$2,cpf=coalesce(cpf,$3),updated_at=now() where id=$1', [user.id, user.name, user.cpf]);
      const d = fornecedor.dados;
      await sql.query(`insert into public.fornecedores
        (id_usuario,tipo_pessoa,nome_exibicao,cnpj,bio,cidade_atuacao,uf_atuacao,raio_atendimento_km,registro_profissional)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [user.id, fornecedor.tipoPessoa, d.nomeExibicao, fornecedor.cnpj, d.bio, d.cidadeAtuacao, d.ufAtuacao, d.raioAtendimentoKm, d.registroProfissional]);
      await this.saveContato(sql, contato);
      await this.insertEspecialidades(sql, user.id, especialidades);
      await this.syncPrestador(sql, user.id, especialidades, d.cidadesAtuacao ?? [d.cidadeAtuacao]);
    }));
  }

  private async saveContato(sql: Sql, contato: Contato): Promise<void> {
    const existentes = await sql.query<{ id: string }>(`update public.contatos set valor=$2,principal=true
      where id=(select id from public.contatos where id_usuario=$1 and tipo in ('telefone','whatsapp') order by principal desc,id limit 1) returning id`,
    [contato.idUsuario, contato.valor]);
    if (!existentes.length) await new ContatoRepository(sql).add(contato);
    await sql.query('update public.contatos set principal=false where id_usuario=$1 and principal=true and id<>$2', [contato.idUsuario, existentes[0]?.id ?? contato.id]);
  }

  private validate(user: User, fornecedor: Fornecedor, contato: Contato, codigos: string[]): void {
    if (user.role !== UserRole.Prestador || !user.isActive || user.id !== fornecedor.idUsuario || user.id !== contato.idUsuario) {
      throw new DomainException('Usuário, fornecedor e contato devem pertencer ao mesmo Prestador ativo.');
    }
    fornecedor.normalizeCpf(user.cpf);
    if (!contato.principal || !['telefone', 'whatsapp'].includes(contato.tipo) || normalizarTelefone(contato.valor) !== contato.valor) {
      throw new DomainException('Informe um telefone principal válido.');
    }
    if (!codigos.length || codigos.length > 100 || new Set(codigos).size !== codigos.length || codigos.some(c => !c.trim() || c.length > 100)) {
      throw new DomainException('Informe ao menos uma especialidade, sem repetições.');
    }
  }

  private async lockEspecialidades(sql: Sql, codigos: string[]): Promise<void> {
    const ativas = await sql.query<{ codigo: string }>(`select e.codigo from public.especialidades e
      join public.categorias_servico c on replace(c.slug, '-', '_')=e.codigo and c.ativo
      where e.is_active and e.codigo=any($1::text[]) order by e.codigo for share of e,c`, [codigos]);
    if (ativas.length !== codigos.length) throw new DomainException('Há especialidades inexistentes ou inativas.');
  }

  private async insertEspecialidades(sql: Sql, id: string, codigos: string[]): Promise<void> {
    await sql.query('insert into fornecedor_especialidades(id_usuario,codigo_especialidade) select $1,unnest($2::text[])', [id, codigos]);
  }

  private async syncPrestador(sql: Sql, id: string, codigos: string[], cidades: string[]): Promise<void> {
    await sql.query('delete from public.prestador_categorias where id_prestador=$1', [id]);
    await sql.query(`insert into public.prestador_categorias(id_prestador,id_categoria)
      select $1,c.id from public.categorias_servico c where replace(c.slug,'-','_')=any($2::text[])`, [id, codigos]);
    await sql.query('delete from public.prestador_regioes where id_prestador=$1', [id]);
    await sql.query('insert into public.prestador_regioes(id_prestador,cidade) select $1,unnest($2::text[])', [id, cidades]);
  }

  private async translateConflict(action: () => Promise<void>): Promise<void> {
    try { await action(); }
    catch (error) {
      if ((error as { code?: string }).code === '23505') throw new ConflictException('E-mail, documento ou perfil já cadastrado.');
      throw error;
    }
  }
}
