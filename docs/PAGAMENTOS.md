# Pagamento por Pix (AbacatePay)

Resolvai_Cliente#96 e #97. Depois que as duas partes assinam o contrato ([CONTRATOS.md](CONTRATOS.md)), o contratante paga por Pix. A cobrança é criada na AbacatePay v2 (Pix transparente) e, quando confirmada, o pedido passa a **InProgress**.

## Fluxo

```
contrato Signed  →  POST /orders/{id}/payment  →  Pix Pending  →  pago  →  pedido InProgress
                                                      │
                                       webhook transparent.completed
                                       ou consulta de status (GET /orders/{id}/payment)
```

- Aceitar a proposta **não** coloca o pedido em andamento; só o pagamento confirmado faz isso.
- A confirmação acontece de dois jeitos, e os dois valem: o **webhook** da AbacatePay e a **consulta de status** que a API faz quando a tela pergunta o estado. Por isso o pagamento funciona também onde o webhook não chega (máquina local, Render dormindo).
- Os dois caminhos são idempotentes: confirmar duas vezes não muda nada.

## Rotas

| Método | Rota | Quem |
| --- | --- | --- |
| POST | `/api/v1/orders/{id}/payment` | Contratante dono do pedido; gera o Pix |
| GET | `/api/v1/orders/{id}/payment` | Contratante; estado do pagamento |
| POST | `/api/v1/orders/{id}/payment/simulate` | Contratante; só modo de teste |
| POST | `/api/v1/webhooks/abacatepay` | AbacatePay (público, com segredo e assinatura) |

Regras de `POST /payment`:

- 404 se o pedido não é do usuário ou ainda não tem contrato.
- 409 enquanto o contrato não está assinado pelas duas partes.
- 409 se o pedido já foi pago.
- Se já existe um Pix pendente, devolve o mesmo (não cobra duas vezes). Dois pedidos simultâneos resultam em uma só cobrança viva (índice único parcial em `pagamentos`).
- 409 se o valor do contrato for menor que R$ 1,00 (mínimo da AbacatePay).
- 503 se a AbacatePay não está configurada ou fora do ar. O texto de erro do provedor não é repassado ao usuário.

Um Pix expirado ou cancelado permite gerar outro. Se um Pix expirado for pago depois, o pagamento vale: a cobrança nova pendente é cancelada e o pedido segue.

### Resposta

| Campo | Significado |
| --- | --- |
| `status` | `Pending`, `Paid`, `Expired` ou `Cancelled` |
| `amount` | Valor em reais (a AbacatePay recebe em centavos) |
| `brCode` | Pix copia e cola |
| `qrCodeBase64` | Imagem do QR Code, data URI PNG |
| `expiresAt` | Validade do Pix (30 minutos) |
| `paidAt` | Quando foi confirmado |
| `testMode` | `true` com a chave de teste (`abc_dev_`); só então `/simulate` funciona |

## Webhook

A AbacatePay chama `POST /api/v1/webhooks/abacatepay` com o evento `transparent.completed`. A rota é pública e recusa com **401** tudo que não passar nas duas conferências:

1. **Segredo**: o valor de `ABACATEPAY_WEBHOOK_SECRET`, enviado no header `X-Webhook-Secret` ou na query `?webhookSecret=`.
2. **Assinatura**: `X-Webhook-Signature`, HMAC-SHA256 em base64 do **corpo bruto**, com a chave pública da AbacatePay (constante documentada em `src/domain/pagamento.ts`; não é o nosso segredo). Por isso a rota lê o JSON como texto antes de interpretar.

Eventos que não interessam, corpo inválido e cobranças desconhecidas respondem 200, para a AbacatePay não repetir a entrega. Sem `ABACATEPAY_WEBHOOK_SECRET` o webhook responde 503.

## Configuração

| Variável | Uso |
| --- | --- |
| `ABACATEPAY_API_KEY` | Chave de API v2. `abc_dev_...` = teste, `abc_prod_...` = produção. Sem ela, o pagamento responde 503 |
| `ABACATEPAY_WEBHOOK_SECRET` | Segredo (32+ caracteres) cadastrado no webhook v2 da AbacatePay |
| `ABACATEPAY_API_URL` | Opcional, padrão `https://api.abacatepay.com/v2` |

A chave precisa das permissões `TRANSPARENT:CREATE` e `TRANSPARENT:READ`. As chaves ficam só em variável de ambiente, nunca no repositório. O webhook de teste e o de produção são cadastrados separadamente na AbacatePay e a URL precisa ser HTTPS pública.

## Testando sem pagar

1. Chave `abc_dev_...` no `.env` e contrato assinado pelas duas partes.
2. `POST /api/v1/orders/{id}/payment` gera o Pix.
3. `POST /api/v1/orders/{id}/payment/simulate` paga o Pix de teste (usa o endpoint de simulação da AbacatePay).
4. `GET /api/v1/orders/{id}/payment` mostra `Paid` e o pedido fica `InProgress`.

## Banco

`db/scripts/020_create_pagamentos.sql` (e a cópia em `supabase/migrations`) cria `public.pagamentos`: valor em centavos, `id_externo` (id da cobrança na AbacatePay, único), `br_code`, `qr_code_base64`, `ambiente_teste`, `expira_em`, `pago_em`. A API não roda migrações sozinha; aplique o script antes do deploy.
