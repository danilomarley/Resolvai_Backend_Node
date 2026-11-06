import type { CurrentUser } from '../contracts.js';
import type { PrestadorPublico } from '../dtos/prestador-publico.js';
import { NotFoundException, UnauthorizedException } from '../errors.js';

export interface IPrestadorPublicoQueries {
  getById(id: string, customerId: string): Promise<PrestadorPublico | null>;
}
export class PrestadorPublicoService {
  constructor(private readonly queries: IPrestadorPublicoQueries) {}
  async consultar(user: CurrentUser, id: string): Promise<PrestadorPublico> {
    if (!user.isAuthenticated || !user.id) throw new UnauthorizedException();
    const profile = user.role === 'Cliente' ? await this.queries.getById(id, user.id) : null;
    if (!profile) throw new NotFoundException('Prestador', id);
    return profile;
  }
}
