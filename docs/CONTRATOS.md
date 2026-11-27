# Contrato de prestação de serviços

Resolvai_Cliente#95. O contrato é gerado quando o contratante **aceita uma proposta** e precisa ser assinado pelas **duas partes** antes do pagamento.

## Fluxo

```
aceite da proposta  →  contrato Pending  →  contratante assina  ┐
                                          →  prestador assina   ┴→  contrato Signed  →  pagamento
```

- O contrato nasce no aceite, **na mesma transação** (`POST /orders/{id}/proposals/{proposalId}/accept`): não existe proposta escolhida sem contrato.
- Propostas aceitas antes desta tabela existir ganham o contrato na primeira consulta.
- A ordem das assinaturas não importa. O status vira `Signed` quando a segunda parte assina.
- Assinado, o contrato libera o pagamento (Resolvai_Cliente#96/#97). Este documento não cobre o pagamento.

## Rotas

| Método | Rota | Quem |
| --- | --- | --- |
| GET | `/api/v1/orders/{id}/contract` | Contratante dono do pedido |
| POST | `/api/v1/orders/{id}/contract/sign` | Contratante |
| GET | `/api/v1/provider/proposals/{proposalId}/contract` | Prestador da proposta escolhida |
| POST | `/api/v1/provider/proposals/{proposalId}/contract/sign` | Prestador |

Quem não é parte do contrato, ou consulta um pedido sem proposta aceita, recebe **404** (como nas demais rotas). As rotas do prestador exigem o papel Prestador (403 para os demais).

### Resposta

| Campo | Significado |
| --- | --- |
| `id`, `orderId`, `proposalId` | Identificadores |
| `status` | `Pending` até as duas assinarem; depois `Signed` |
| `text` | Texto integral, com quebras de linha |
| `textHash` | SHA-256 do `text`, em hexadecimal |
| `templateVersion` | Versão do modelo (hoje `2026-11-v1`) |
| `value` | Valor da proposta aceita |
| `customerName`, `providerName` | Nomes como aparecem na proposta |
| `customerSignedAt`, `providerSignedAt` | Data da assinatura de cada parte; ausentes enquanto não assinou |
| `createdAt` | Quando o contrato foi gerado |

### Assinatura

O corpo é `{ "textHash": "<hash do texto lido>" }`. A assinatura só vale para o texto que a pessoa leu: se o hash não for o do contrato gravado, a API devolve **409** pedindo que recarregue e leia de novo. Também retorna 409 quando a parte já assinou. Cada assinatura grava a data e o IP de quem assinou (`assinado_*_em`, `assinatura_*_ip`).

## O texto

Gerado por `gerarTextoContrato` (`src/domain/contrato.ts`) com 12 cláusulas: partes, objeto, proposta aceita, valor e pagamento, prazo, garantia, obrigações de cada parte, alteração e cancelamento, papel da plataforma, dados pessoais (LGPD), assinatura eletrônica e foro (Fortaleza/CE).

- **Valor, prazo e garantia vêm da proposta aceita**, nunca de valores fixos. O que a proposta não informa aparece como "a combinar" ou "não informada", em vez de inventado.
- **Documentos mascarados:** CPF aparece como `***.123.456-**` e CNPJ como `**.***.***/0001-**`. O documento inteiro não vai para o texto, que a outra parte lê.
- **Nome do prestador** é o `users.name`, o mesmo da tela de propostas, para o contrato não divergir da proposta.
- O texto gerado é **gravado** com o hash e a versão do modelo. Mudar o modelo no código não altera contratos já gerados.

> O modelo é um texto padrão para esta fase do projeto e deve ser revisado por quem responde juridicamente pela plataforma antes de uso em produção. A cláusula de repasse descreve a regra da plataforma sem detalhá-la, porque o repasse ainda não está definido.

## Banco

`db/scripts/019_create_contratos.sql` e `supabase/migrations/20261126130000_create_contratos.sql` criam `public.contratos`, com um contrato por pedido e por proposta, RLS habilitado e sem acesso direto pelo cliente Supabase. Aplicar no banco real antes do deploy: sem a tabela o aceite de proposta falha.
