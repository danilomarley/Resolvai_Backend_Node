import type { IUserRepository } from '../../application/contracts.js';
import { Email } from '../../domain/email.js';
import { parseUserRole } from '../../domain/enums.js';
import { User } from '../../domain/user.js';
import type { Sql } from '../database.js';

const selectColumns = `
  select id         as "id",
         name       as "name",
         email      as "emailAddress",
         role       as "role",
         is_active  as "isActive",
         created_at as "createdAt",
         updated_at as "updatedAt",
         cpf        as "cpf"
    from users`;

interface UserRow {
  id: string;
  name: string;
  emailAddress: string;
  role: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date | null;
  cpf: string | null;
}

export class UserRepository implements IUserRepository {
  constructor(private readonly sql: Sql) {}

  async getById(id: string): Promise<User | null> {
    const [row] = await this.sql.query<UserRow>(`${selectColumns} where id = $1;`, [id]);
    return row ? toDomain(row) : null;
  }

  async getByEmail(email: Email): Promise<User | null> {
    const [row] = await this.sql.query<UserRow>(`${selectColumns} where email = $1;`, [email.value]);
    return row ? toDomain(row) : null;
  }

  async existsByEmail(email: Email): Promise<boolean> {
    const [row] = await this.sql.query<{ exists: boolean }>(
      'select exists (select 1 from users where email = $1) as "exists";',
      [email.value]
    );
    return row?.exists ?? false;
  }

  async existsByCpf(cpf: string, excludingUserId: string): Promise<boolean> {
    const [row] = await this.sql.query<{ exists: boolean }>(
      'select exists (select 1 from users where cpf = $1 and id <> $2) as "exists";',
      [cpf, excludingUserId]
    );
    return row?.exists ?? false;
  }

  async getAll(): Promise<User[]> {
    const rows = await this.sql.query<UserRow>(`${selectColumns} order by created_at desc;`);
    return rows.map(toDomain);
  }

  async add(user: User): Promise<void> {
    await this.sql.query(
      `insert into users (id, name, email, role, is_active, created_at, updated_at, cpf)
       values ($1, $2, $3, $4, $5, $6, $7, $8);`,
      [user.id, user.name, user.email.value, user.role, user.isActive, user.createdAt, user.updatedAt, user.cpf]
    );
  }

  async update(user: User): Promise<void> {
    await this.sql.query(
      `update users
          set name       = $2,
              email      = $3,
              role       = $4,
              is_active  = $5,
              updated_at = $6,
              cpf        = $7
        where id = $1;`,
      [user.id, user.name, user.email.value, user.role, user.isActive, user.updatedAt, user.cpf]
    );
  }
}

function toDomain(row: UserRow): User {
  const role = parseUserRole(row.role);
  if (!role) {
    throw new Error(`Papel desconhecido em users.role: '${row.role}'.`);
  }

  return User.restore(row.id, row.name, Email.create(row.emailAddress), role, row.isActive, row.createdAt, row.updatedAt, row.cpf);
}
