import type { Sql } from '../database.js';
import { abertoSemEscolhida, compativelExpr } from './prestador-sql.js';

export type ElegibilidadeProposta = 'available' | 'incomplete' | 'unavailable';

/** Shared by the JSON and multipart submission APIs. Call after locking the order. */
export async function avaliarPedidoParaProposta(sql: Sql, orderId: string, providerId: string, lock = false): Promise<ElegibilidadeProposta> {
  if (lock) {
    // Profile writers lock this user before changing categories or cities.
    // Read eligibility in a subsequent statement so it sees a writer that just committed.
    await sql.query('select id from public.users where id=$1 for share', [providerId]);
  }
  const [result] = await sql.query<{ registrationComplete: boolean; available: boolean | null }>(`select
      (
        ((f.id_usuario is null or f.tipo_pessoa='PF') and nullif(btrim(u.cpf),'') is not null)
        or (f.tipo_pessoa='PJ' and nullif(btrim(f.cnpj),'') is not null)
      ) as "registrationComplete",
      (p.id_cliente<>$2 and ${abertoSemEscolhida} and ${compativelExpr('$2')}) as "available"
    from public.users u
    left join public.fornecedores f on f.id_usuario=u.id
    left join public.pedidos p on p.id=$1
    where u.id=$2 and u.role='Prestador' and u.is_active=true`, [orderId, providerId]);
  if (!result) return 'unavailable';
  if (!result.registrationComplete) return 'incomplete';
  return result.available ? 'available' : 'unavailable';
}

export async function pedidoDisponivelParaProposta(sql: Sql, orderId: string, providerId: string, lock = false): Promise<boolean> {
  return await avaliarPedidoParaProposta(sql, orderId, providerId, lock) === 'available';
}
