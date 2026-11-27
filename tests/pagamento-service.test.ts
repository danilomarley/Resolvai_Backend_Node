import { createHmac, randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { ConflictException, NotFoundException, ServicoIndisponivelException, UnauthorizedException } from '../src/application/errors.js';
import { PagamentoService } from '../src/application/services/pagamento-service.js';
import { chavePublicaAbacatePay } from '../src/domain/pagamento.js';
import { AbacatePayClient } from '../src/infrastructure/pagamento/abacatepay-client.js';
import { FakeGatewayPagamento, FakePagamentoRepository, usuario } from './fakes.js';

const segredo = 'segredo-do-webhook-de-teste-com-mais-de-32-caracteres';
const cliente = randomUUID();
const pedido = randomUUID();

describe('PagamentoService', () => {
  let repo: FakePagamentoRepository;
  let gateway: FakeGatewayPagamento;
  let service: PagamentoService;
  const eu = usuario(cliente);

  beforeEach(() => {
    repo = new FakePagamentoRepository();
    gateway = new FakeGatewayPagamento();
    service = new PagamentoService(repo, gateway, segredo);
    repo.contrato = { orderId: pedido, contractId: randomUUID(), contractStatus: 'assinado', value: 800 };
  });

  it('gera o Pix em centavos, com descrição curta e metadados, e devolve o mesmo enquanto estiver pendente', async () => {
    const primeiro = await service.iniciar(eu, pedido);
    expect(primeiro).toMatchObject({ orderId: pedido, method: 'Pix', status: 'Pending', amount: 800, testMode: true });
    expect(primeiro.brCode).toContain('pix-teste-1');
    expect(gateway.criadas).toHaveLength(1);
    expect(gateway.criadas[0]).toMatchObject({ valorCentavos: 80000, expiraEmSegundos: 1800 });
    expect(gateway.criadas[0]!.descricao).toBe(`ResolvAI pedido ${pedido.slice(0, 8).toUpperCase()}`);
    expect(gateway.criadas[0]!.metadata).toMatchObject({ pedidoId: pedido });

    const segundo = await service.iniciar(eu, pedido);
    expect(segundo.id).toBe(primeiro.id);
    expect(gateway.criadas).toHaveLength(1);
  });

  it('só cobra com o contrato assinado pelas duas partes e para o dono do pedido', async () => {
    repo.contrato = { ...repo.contrato!, contractStatus: 'pendente' };
    await expect(service.iniciar(eu, pedido)).rejects.toThrow(ConflictException);
    repo.contrato = null;
    await expect(service.iniciar(eu, pedido)).rejects.toThrow(NotFoundException);
    expect(gateway.criadas).toHaveLength(0);
  });

  it('recusa valor abaixo do mínimo da AbacatePay', async () => {
    repo.contrato = { ...repo.contrato!, value: 0.5 };
    await expect(service.iniciar(eu, pedido)).rejects.toThrow('menor que o mínimo');
  });

  it('sem a AbacatePay configurada responde indisponível', async () => {
    const semGateway = new PagamentoService(repo, undefined, undefined);
    await expect(semGateway.iniciar(eu, pedido)).rejects.toThrow(ServicoIndisponivelException);
    await expect(semGateway.simular(eu, pedido)).rejects.toThrow(ServicoIndisponivelException);
  });

  it('a consulta confirma o pagamento sem depender do webhook', async () => {
    await service.iniciar(eu, pedido);
    gateway.statusPorId.set(repo.atual!.externalId, 'PAID');

    const pago = await service.obter(eu, pedido);
    expect(pago.status).toBe('Paid');
    expect(pago.paidAt).toBeDefined();
    expect(repo.confirmados).toEqual([repo.atual!.externalId]);
    await expect(service.iniciar(eu, pedido)).rejects.toThrow('já foi pago');
  });

  it('cobrança expirada permite gerar um novo Pix', async () => {
    const primeiro = await service.iniciar(eu, pedido);
    gateway.statusPorId.set(repo.atual!.externalId, 'EXPIRED');

    expect((await service.obter(eu, pedido)).status).toBe('Expired');
    const novo = await service.iniciar(eu, pedido);
    expect(novo.status).toBe('Pending');
    expect(novo.id).not.toBe(primeiro.id);
    expect(gateway.criadas).toHaveLength(2);
  });

  it('falha ao consultar a AbacatePay não derruba a leitura do estado', async () => {
    await service.iniciar(eu, pedido);
    gateway.falhaNaConsulta = true;
    expect((await service.obter(eu, pedido)).status).toBe('Pending');
  });

  it('sem cobrança o estado é 404', async () => {
    await expect(service.obter(eu, pedido)).rejects.toThrow(NotFoundException);
  });

  it('a simulação paga a cobrança de teste e só vale em modo de teste e para cobrança pendente', async () => {
    await service.iniciar(eu, pedido);
    const pago = await service.simular(eu, pedido);
    expect(pago.status).toBe('Paid');
    expect(gateway.simuladas).toEqual([repo.atual!.externalId]);
    await expect(service.simular(eu, pedido)).rejects.toThrow('não está mais pendente');

    const producao = new FakeGatewayPagamento();
    producao.ambienteTeste = false;
    const emProducao = new PagamentoService(repo, producao, segredo);
    repo.atual = { ...repo.atual!, status: 'pendente', paidAt: null };
    await expect(emProducao.simular(eu, pedido)).rejects.toThrow('só existe em modo de teste');
    expect(producao.simuladas).toHaveLength(0);
  });

  it('exige usuário identificado', async () => {
    await expect(service.iniciar(usuario(), pedido)).rejects.toThrow(UnauthorizedException);
  });
});

describe('PagamentoService.processarWebhook', () => {
  const evento = (id: string, status = 'PAID', event = 'transparent.completed') => JSON.stringify({ event, data: { transparent: { id, status } } });
  const assinar = (corpo: string) => createHmac('sha256', chavePublicaAbacatePay).update(corpo).digest('base64');
  let repo: FakePagamentoRepository;
  let service: PagamentoService;

  beforeEach(() => {
    repo = new FakePagamentoRepository();
    service = new PagamentoService(repo, new FakeGatewayPagamento(), segredo);
  });

  it('confirma o pagamento com segredo e assinatura válidos', async () => {
    const corpo = evento('pix_char_1');
    await service.processarWebhook({ corpoBruto: corpo, secretHeader: segredo, assinatura: assinar(corpo) });
    expect(repo.confirmados).toEqual(['pix_char_1']);
  });

  it('aceita o segredo na query string', async () => {
    const corpo = evento('pix_char_2');
    await service.processarWebhook({ corpoBruto: corpo, secretQuery: segredo, assinatura: assinar(corpo) });
    expect(repo.confirmados).toEqual(['pix_char_2']);
  });

  it('recusa segredo errado, assinatura errada ou ausente, sem tocar no banco', async () => {
    const corpo = evento('pix_char_3');
    await expect(service.processarWebhook({ corpoBruto: corpo, secretHeader: 'outro', assinatura: assinar(corpo) })).rejects.toThrow(UnauthorizedException);
    await expect(service.processarWebhook({ corpoBruto: corpo, secretHeader: segredo, assinatura: 'x' })).rejects.toThrow(UnauthorizedException);
    await expect(service.processarWebhook({ corpoBruto: corpo, assinatura: assinar(corpo) })).rejects.toThrow(UnauthorizedException);
    await expect(service.processarWebhook({ corpoBruto: `${corpo} `, secretHeader: segredo, assinatura: assinar(corpo) })).rejects.toThrow(UnauthorizedException);
    expect(repo.confirmados).toHaveLength(0);
  });

  it('sem segredo configurado o webhook fica indisponível', async () => {
    const semSegredo = new PagamentoService(repo, undefined, undefined);
    const corpo = evento('pix_char_4');
    await expect(semSegredo.processarWebhook({ corpoBruto: corpo, secretHeader: segredo, assinatura: assinar(corpo) })).rejects.toThrow(ServicoIndisponivelException);
  });

  it('ignora eventos que não interessam e corpo que não é JSON, e encerra cobrança expirada', async () => {
    for (const corpo of [evento('pix_char_5', 'PAID', 'transparent.refunded'), 'isto nao e json', '{}']) {
      await service.processarWebhook({ corpoBruto: corpo, secretHeader: segredo, assinatura: assinar(corpo) });
    }

    const expirada = evento('pix_char_6', 'EXPIRED');
    await service.processarWebhook({ corpoBruto: expirada, secretHeader: segredo, assinatura: assinar(expirada) });
    expect(repo.confirmados).toHaveLength(0);
    expect(repo.encerrados).toEqual([{ externalId: 'pix_char_6', status: 'expirado' }]);
  });
});

describe('AbacatePayClient', () => {
  const resposta = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });

  it('cria o Pix com o corpo v2, o Bearer da chave e devolve o brCode', async () => {
    const chamadas: { url: string; init: RequestInit }[] = [];
    const http = (async (url: string, init: RequestInit) => {
      chamadas.push({ url, init });
      return resposta({
        data: { id: 'pix_char_abc', status: 'PENDING', brCode: '000201', brCodeBase64: 'data:image/png;base64,AAAA', expiresAt: '2026-11-27T12:00:00.000Z' },
        success: true,
        error: null
      });
    }) as unknown as typeof fetch;
    const client = new AbacatePayClient({ apiKey: 'abc_dev_chave', baseUrl: 'https://api.exemplo/v2' }, http);

    const cobranca = await client.criarPix({ valorCentavos: 80000, descricao: 'ResolvAI pedido X', idExterno: 'id-1', expiraEmSegundos: 1800, metadata: { pedidoId: 'p' } });
    expect(cobranca).toMatchObject({ id: 'pix_char_abc', brCode: '000201', qrCodeBase64: 'data:image/png;base64,AAAA' });
    expect(cobranca.expiraEm?.toISOString()).toBe('2026-11-27T12:00:00.000Z');
    expect(client.ambienteTeste).toBe(true);
    expect(chamadas[0]!.url).toBe('https://api.exemplo/v2/transparents/create');
    expect(chamadas[0]!.init.method).toBe('POST');
    expect((chamadas[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer abc_dev_chave');
    expect(JSON.parse(chamadas[0]!.init.body as string)).toEqual({
      method: 'PIX',
      data: { amount: 80000, description: 'ResolvAI pedido X', expiresIn: 1800, externalId: 'id-1', metadata: { pedidoId: 'p' } }
    });
  });

  it('consulta e simula com o id na query string', async () => {
    const urls: string[] = [];
    const http = (async (url: string) => {
      urls.push(url);
      return resposta({ data: { id: 'pix_char_abc', status: 'PAID' }, success: true, error: null });
    }) as unknown as typeof fetch;
    const client = new AbacatePayClient({ apiKey: 'abc_prod_chave', baseUrl: 'https://api.exemplo/v2' }, http);

    expect(await client.consultar('pix_char_abc')).toEqual({ status: 'PAID' });
    await client.simularPagamento('pix_char_abc');
    expect(urls).toEqual(['https://api.exemplo/v2/transparents/check?id=pix_char_abc', 'https://api.exemplo/v2/transparents/simulate-payment?id=pix_char_abc']);
    expect(client.ambienteTeste).toBe(false);
  });

  it('erro da AbacatePay e falha de rede viram indisponível, sem vazar o texto do provedor nem a chave', async () => {
    const recusa = (async () => resposta({ data: null, success: false, error: 'PIX is not available for this store' }, 400)) as unknown as typeof fetch;
    const rede = (async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch;

    for (const http of [recusa, rede]) {
      const client = new AbacatePayClient({ apiKey: 'abc_dev_segredo', baseUrl: 'https://api.exemplo/v2' }, http);
      const erro = (await client.consultar('x').catch((e: unknown) => e)) as Error;
      expect(erro).toBeInstanceOf(ServicoIndisponivelException);
      expect(erro.message).not.toContain('not available');
      expect(erro.message).not.toContain('abc_dev_segredo');
    }
  });
});
