import type { IPrestadorPublicoQueries } from '../../application/services/prestador-publico-service.js';
import type { PrestadorPublico } from '../../application/dtos/prestador-publico.js';
import type { Database } from '../database.js';

export class PrestadorPublicoQueries implements IPrestadorPublicoQueries {
  constructor(private readonly database: Database) {}
  getById(id: string, customerId: string): Promise<PrestadorPublico | null> {
    return this.database.transaction(async sql => {
      const [provider] = await sql.query<{ id: string; name: string; completedServices: number }>(`
        select u.id, u.name,
          (select count(*) from public.pedidos p where p.status = 'concluido' and exists (
            select 1 from public.propostas pr where pr.id_pedido = p.id and pr.id_prestador = u.id and pr.status = 'escolhida'
          )) as "completedServices"
        from public.users u where u.id = $1 and u.role = 'Prestador' and u.is_active = true
          and exists (select 1 from public.propostas pr join public.pedidos p on p.id = pr.id_pedido
            where pr.id_prestador = u.id and p.id_cliente = $2)`, [id, customerId]);
      if (!provider) return null;

      // Os dados profissionais são mantidos pela equipe de fornecedores (esquema C# 012/013).
      // A main Node não os instala. A ausência é informada, sem substituir por dados do endereço privado.
      const [tables] = await sql.query<{ metadata: boolean; reviews: boolean }>(`select
        (to_regclass('public.fornecedores') is not null and to_regclass('public.especialidades') is not null
          and to_regclass('public.fornecedor_especialidades') is not null) as metadata,
        (to_regclass('public.avaliacoes') is not null) as reviews`);
      const profile: PrestadorPublico = { ...provider, photoUrl: null, categories: null, region: null,
        reviewsAvailable: tables!.reviews, reviewsCount: null, averageRating: null, reviews: [] };
      if (tables!.metadata) {
        const [metadata] = await sql.query<{ name: string; region: string }>(`
          select nome_exibicao as name, cidade_atuacao || ', ' || uf_atuacao as region
          from public.fornecedores where id_usuario = $1`, [id]);
        if (metadata) {
          profile.name = metadata.name;
          profile.region = metadata.region;
          const categories = await sql.query<{ name: string }>(`select e.nome as name from public.fornecedor_especialidades fe
            join public.especialidades e on e.codigo = fe.codigo_especialidade
            where fe.id_usuario = $1 and e.is_active = true order by e.nome`, [id]);
          profile.categories = categories.map(c => c.name);
        }
      }
      if (tables!.reviews) {
        // Contrato da migration da #92; nenhuma cópia de commits ou migration daquela issue.
        const [average] = await sql.query<{ value: number | null; count: number }>('select avg(nota)::numeric as value, count(*) as count from public.avaliacoes where id_prestador = $1', [id]);
        profile.averageRating = average!.value;
        profile.reviewsCount = average!.count;
        const reviews = await sql.query<{ rating: number; comment: string | null; createdAt: Date }>(`
          select nota as rating, comentario as comment, data_criacao as "createdAt"
          from public.avaliacoes where id_prestador = $1 order by data_criacao desc, id_pedido desc limit 5`, [id]);
        profile.reviews = reviews.map(r => ({ rating: r.rating, comment: r.comment ?? undefined, createdAt: r.createdAt.toISOString() }));
      }
      return profile;
    }, 'repeatable read');
  }
}
