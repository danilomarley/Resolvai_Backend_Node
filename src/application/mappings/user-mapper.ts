import type { User } from '../../domain/user.js';
import type { UserResponse } from '../dtos/users.js';

export function toUserResponse(user: User): UserResponse {
  return {
    id: user.id,
    name: user.name,
    email: user.email.value,
    role: user.role,
    isActive: user.isActive,
    createdAt: user.createdAt.toISOString(),
    cpf: user.cpf ?? undefined
  };
}
