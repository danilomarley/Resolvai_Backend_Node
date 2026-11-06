import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { PropostaService, type IPropostaRepository } from '../src/application/services/proposta-service.js';
import { NotFoundException, UnauthorizedException } from '../src/application/errors.js';
import { propostaDeTeste } from './fakes.js';

describe('PropostaService', () => {
  const user = { isAuthenticated: true, id: randomUUID(), role: 'Cliente' as const };
  const orderId = randomUUID();
  const proposalId = randomUUID();
  const detalhe = (status: 'Sent' | 'Viewed' | 'Chosen') => ({
    ...propostaDeTeste(proposalId, { status }),
    providerProfile: { memberSince: new Date().toISOString(), completedServices: 0 }
  });
  const novo = () => {
    const repository: IPropostaRepository = { list: vi.fn(), getById: vi.fn(), markViewed: vi.fn() };
    return { repository, service: new PropostaService(repository) };
  };

  it('exige usuário autenticado com identificação', async () => {
    const { repository, service } = novo();
    await expect(service.list({ isAuthenticated: false }, orderId, {})).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.list({ isAuthenticated: true, id: '00000000-0000-0000-0000-000000000000' }, orderId, {})).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.getById({ isAuthenticated: false }, orderId, proposalId)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(repository.list).not.toHaveBeenCalled();
  });

  it('aplica os padrões: preço e prazo crescentes, avaliação decrescente', async () => {
    const { repository, service } = novo();
    vi.mocked(repository.list).mockResolvedValue([]);
    await service.list(user, orderId, {});
    await service.list(user, orderId, { sort: 'deadline' });
    await service.list(user, orderId, { sort: 'rating' });
    await service.list(user, orderId, { sort: 'rating', direction: 'asc' });
    await service.list(user, orderId, { sort: 'price', direction: 'desc' });
    expect(vi.mocked(repository.list).mock.calls.map(([, , sort, direction]) => `${sort}:${direction}`))
      .toEqual(['price:asc', 'deadline:asc', 'rating:desc', 'rating:asc', 'price:desc']);
  });

  it('pedido inexistente vira 404; lista vazia é válida', async () => {
    const { repository, service } = novo();
    vi.mocked(repository.list).mockResolvedValueOnce(null);
    await expect(service.list(user, orderId, {})).rejects.toBeInstanceOf(NotFoundException);
    vi.mocked(repository.list).mockResolvedValueOnce([]);
    await expect(service.list(user, orderId, {})).resolves.toEqual([]);
  });

  it('abrir o detalhe de uma proposta enviada a marca como visualizada', async () => {
    const { repository, service } = novo();
    vi.mocked(repository.getById).mockResolvedValue(detalhe('Sent'));
    vi.mocked(repository.markViewed).mockResolvedValue(true);
    await expect(service.getById(user, orderId, proposalId)).resolves.toMatchObject({ status: 'Viewed' });
    expect(repository.markViewed).toHaveBeenCalledWith(orderId, proposalId, user.id);
  });

  it('não marca quando já foi vista ou escolhida, nem inventa status se a marcação não ocorreu', async () => {
    const { repository, service } = novo();
    for (const status of ['Viewed', 'Chosen'] as const) {
      vi.mocked(repository.getById).mockResolvedValueOnce(detalhe(status));
      await expect(service.getById(user, orderId, proposalId)).resolves.toMatchObject({ status });
    }
    expect(repository.markViewed).not.toHaveBeenCalled();

    vi.mocked(repository.getById).mockResolvedValueOnce(detalhe('Sent'));
    vi.mocked(repository.markViewed).mockResolvedValueOnce(false);
    await expect(service.getById(user, orderId, proposalId)).resolves.toMatchObject({ status: 'Sent' });
  });

  it('proposta inexistente vira 404 e nada é marcado', async () => {
    const { repository, service } = novo();
    vi.mocked(repository.getById).mockResolvedValue(null);
    await expect(service.getById(user, orderId, proposalId)).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.markViewed).not.toHaveBeenCalled();
  });
});
