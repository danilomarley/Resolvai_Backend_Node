import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { Email } from '../src/domain/email.js';
import { UserRole } from '../src/domain/enums.js';
import { User } from '../src/domain/user.js';
import { FornecedorService } from '../src/application/services/fornecedor-service.js';
import { PropostaService } from '../src/application/services/proposta-service.js';
import { NotFoundException } from '../src/application/errors.js';
import type { CriarProposta, IPropostaRepository, PropostaEnviada, PropostaRegistro } from '../src/application/dtos/propostas.js';
import { FakeEspecialidades, FakeFornecedores, FakeSupabase, FakeUsers } from './fakes.js';

function setup() {
  const provider = randomUUID();
  const order = randomUUID();
  const users = new FakeUsers();
  users.user = User.register(provider, 'Fornecedor', Email.create('synthetic@example.invalid'), UserRole.Prestador);
  const profiles = new FakeFornecedores();
  profiles.profiles.set(provider, { idUsuario: provider, name: 'Fornecedor', email: 'synthetic@example.invalid', tipoPessoa: 'PF', nomeExibicao: 'Fornecedor', cnpj: null,
    bio: null, telefone: '85999990000', cidadeAtuacao: 'Fortaleza', ufAtuacao: 'CE', raioAtendimentoKm: 20, registroProfissional: null, especialidades: ['eletrica'], createdAt: new Date().toISOString(), updatedAt: null });
  const data: CriarProposta = { requestId: randomUUID(), valueCents: 10000, deadline: '3 dias', description: 'Diagnóstico e reparo completo do circuito.', guaranteePeriod: '90 dias', guaranteeType: 'Reexecução gratuita', materials: undefined, guaranteeConditions: undefined };
  let stored: PropostaRegistro | null = null;
  const repository: IPropostaRepository = {
    find: async () => stored,
    assertAvailable: async () => {},
    create: async (_order, _provider, _data, hash, portfolio) => {
      const proposal: PropostaEnviada = { id: data.requestId, orderId: order, status: 'Sent', value: 100, deadline: data.deadline, description: data.description,
        warranty: { period: data.guaranteePeriod, type: data.guaranteeType }, portfolio, createdAt: new Date().toISOString() };
      stored = { proposal, providerId: provider, payloadHash: hash };
      return { proposal, created: true };
    }
  };
  const storage = { enviar: vi.fn(async (path: string) => `https://storage.invalid/${path}`), remover: vi.fn(async (_paths: string[]) => {}) };
  const service = new PropostaService(new FornecedorService(users, profiles, new FakeEspecialidades(), new FakeSupabase()), repository, storage);
  const photo = { conteudo: Buffer.from([137,80,78,71,13,10,26,10,0]), contentType: 'image/png', name: 'portfolio.png' };
  return { provider, order, data, photo, repository, storage, service };
}

describe('proposal upload compensation and uncertain commit', () => {
  it('removes only this attempt files when uploading fails', async () => {
    const fixture = setup();
    fixture.storage.enviar.mockRejectedValueOnce(new Error('upload failed'));
    await expect(fixture.service.create({ isAuthenticated: true, id: fixture.provider }, fixture.order, fixture.data, [fixture.photo])).rejects.toMatchObject({ name: 'ServicoIndisponivelException' });
    expect(fixture.storage.remover).toHaveBeenCalledWith([fixture.storage.enviar.mock.calls[0]![0]]);
  });
  it('cleans up uploaded files when the order becomes unavailable before insert', async () => {
    const fixture = setup();
    fixture.repository.create = async () => { throw new NotFoundException('Pedido', fixture.order); };
    await expect(fixture.service.create({ isAuthenticated: true, id: fixture.provider }, fixture.order, fixture.data, [fixture.photo])).rejects.toMatchObject({ name: 'NotFoundException' });
    expect(fixture.storage.remover).toHaveBeenCalledOnce();
  });
  it('recovers a lost commit response without deleting referenced photos', async () => {
    const fixture = setup();
    const commit = fixture.repository.create;
    fixture.repository.create = async (...args) => { await commit(...args); throw new Error('connection lost after COMMIT'); };
    const result = await fixture.service.create({ isAuthenticated: true, id: fixture.provider }, fixture.order, fixture.data, [fixture.photo]);
    expect(result.id).toBe(fixture.data.requestId);
    expect(fixture.storage.remover).not.toHaveBeenCalled();
  });
  it('does not delete photos when persistence cannot be determined', async () => {
    const fixture = setup();
    fixture.repository.create = async () => { throw new Error('unknown commit outcome'); };
    await expect(fixture.service.create({ isAuthenticated: true, id: fixture.provider }, fixture.order, fixture.data, [fixture.photo])).rejects.toMatchObject({ name: 'ServicoIndisponivelException' });
    expect(fixture.storage.remover).not.toHaveBeenCalled();
  });
});
