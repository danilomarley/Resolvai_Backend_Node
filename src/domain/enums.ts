/**
 * Persistido como texto na coluna users.role.
 */
export const UserRole = {
  Cliente: 'Cliente',
  Prestador: 'Prestador',
  Admin: 'Admin'
} as const;

export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const userRoles = Object.values(UserRole);

/**
 * Persistido como texto na coluna pedidos.status (aberto/em_andamento/concluido/cancelado).
 * Os valores ficam em inglês porque são o que a API expõe no JSON e o front já consome.
 */
export const StatusPedido = {
  Pending: 'Pending',
  InProgress: 'InProgress',
  Completed: 'Completed',
  Cancelled: 'Cancelled'
} as const;

export type StatusPedido = (typeof StatusPedido)[keyof typeof StatusPedido];

export const statusPedidos = Object.values(StatusPedido);

/**
 * Persistido como texto na coluna propostas.status (enviada/visualizada/escolhida).
 */
export const StatusProposta = {
  Sent: 'Sent',
  Viewed: 'Viewed',
  Chosen: 'Chosen'
} as const;

export type StatusProposta = (typeof StatusProposta)[keyof typeof StatusProposta];

export const statusPropostas = Object.values(StatusProposta);

/**
 * Converte texto do banco ou da requisição para UserRole sem diferenciar maiúsculas,
 * como o Enum.Parse(ignoreCase: true) da API C#.
 */
export function parseUserRole(value: string | null | undefined): UserRole | undefined {
  const normalized = value?.trim().toLowerCase();
  return userRoles.find(role => role.toLowerCase() === normalized);
}
