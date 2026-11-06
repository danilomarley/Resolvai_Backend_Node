import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { AvaliacaoService, type IAvaliacaoRepository } from '../src/application/services/avaliacao-service.js';
import { ConflictException, NotFoundException, UnauthorizedException } from '../src/application/errors.js';
import { DomainException } from '../src/domain/errors.js';

describe('AvaliacaoService', () => {
  const user = { isAuthenticated: true, id: randomUUID(), role: 'Cliente' as const };
  const id = randomUUID();
  const repository: IAvaliacaoRepository = { criar: vi.fn(), consultar: vi.fn(), resumo: vi.fn() };
  const service = new AvaliacaoService(repository);

  it('exige autenticação e papel de cliente', async () => {
    await expect(service.criar({ isAuthenticated: false }, id, { rating: 5 })).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.criar({ ...user, role: 'Prestador' }, id, { rating: 5 })).rejects.toBeInstanceOf(DomainException);
  });
  it('valida entradas antes de persistir', async () => {
    vi.mocked(repository.criar).mockClear();
    await expect(service.criar(user, id, { rating: 0 })).rejects.toBeInstanceOf(DomainException);
    expect(repository.criar).not.toHaveBeenCalled();
  });
  it('mapeia os conflitos de persistência para erros de aplicação', async () => {
    for (const [result, error] of [['notFound', NotFoundException], ['notCompleted', DomainException], ['invalidProvider', ConflictException], ['duplicate', ConflictException]] as const) {
      vi.mocked(repository.criar).mockResolvedValueOnce(result);
      await expect(service.criar(user, id, { rating: 5 })).rejects.toBeInstanceOf(error);
    }
  });
});
