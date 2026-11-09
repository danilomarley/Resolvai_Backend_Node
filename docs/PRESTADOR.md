# App do prestador: rotas e scripts SQL

Rotas usadas pelo app do prestador ([Resolvai_Prestador](https://github.com/danilomarley/Resolvai_Prestador), escopo em `ESCOPO.md`) e o aceite de proposta do contratante ([Resolvai_Cliente#84](https://github.com/danilomarley/Resolvai_Cliente/issues/84)).

## Banco de dados: modelo único

O perfil profissional usa as tabelas existentes `fornecedores`, `especialidades` e `fornecedor_especialidades`. A cidade principal está em `fornecedores.cidade_atuacao`. Login, perfil, catálogo e feed não exigem tabelas adicionais de categorias ou regiões, nem função SQL de normalização.

Os scripts de criação dos catálogos/vínculos paralelos e o antigo `db/aplicar-prestador.sql` foram retirados. Para reconstrução isolada, os scripts históricos 013/014 criam o modelo de fornecedor. Não os reaplique em massa no banco publicado.

A migração pendente `supabase/migrations/20261109014627_reconcile_fornecedor_prestador.sql` complementa avaliações e propostas: `prazo_dias`, status `nao_escolhida` e unicidade por pedido/prestador e por proposta escolhida. Ela não cria estruturas paralelas de catálogo/região. O envio e acompanhamento de propostas dependem desses campos/índices; avaliações dependem de sua tabela própria. Confira o schema/histórico antes de aplicar e consulte [CONCILIACAO-PR8.md](CONCILIACAO-PR8.md). Nenhuma migração roda automaticamente ao iniciar a API.

## Cadastro

`POST /api/v1/auth/register-provider` (público) recebe o cadastro completo de fornecedor PF/PJ, documento correspondente, contato, especialidades e uma cidade principal. Cliente mantém cadastro simples em `/api/v1/auth/register`. O fornecedor nasce com papel `Prestador`; PJ usa CNPJ e pode concluir o perfil sem CPF. O corpo simples antigo não atende ao novo contrato. Consulte [cadastro profissional](PROVIDER-REGISTRATION.md).

`/provider/profile` e `/fornecedores/me` editam os mesmos registros. As respostas mantêm listas `cities`/`cidadesAtuacao`, com apenas a cidade principal. Várias cidades são recusadas com 400. Contas antigas sem registro em `fornecedores` precisam concluir o perfil pela rota autenticada de cadastro antes de editar ou enviar propostas.

**Mudança de contrato:** em `/catalog/categories`, `id` agora é o código textual de `especialidades`, por exemplo `eletrica`, e `slug` usa hífen no lugar de `_`. `categoryIds` de `/provider/profile` recebe esses códigos, não UUIDs antigos. A seleção e ordenação do catálogo usam somente especialidades ativas, em ordem de nome/código. O frontend de fornecedor já usa esse catálogo canônico por `/especialidades`.

## Rotas do prestador

Todas exigem o papel `Prestador` (403 para os demais), `Cache-Control: no-store`, e usam `ProblemDetails` nos erros.

| Método e rota | Descrição |
| --- | --- |
| `GET /api/v1/catalog/categories` | Catálogo de categorias (qualquer usuário autenticado). |
| `GET` · `PUT /api/v1/provider/profile` | Especialidades e cidade principal. Exemplo: `{ "categoryIds": ["eletrica"], "cities": ["Fortaleza"] }`. `PUT` substitui as especialidades e a cidade. `onboardingComplete` = perfil profissional finalizado + especialidade + cidade. |
| `GET /api/v1/provider/summary` | Indicadores: pedidos novos (24 h), pedidos compatíveis abertos e propostas por status. |
| `GET /api/v1/provider/orders` | Feed de pedidos abertos **sem proposta escolhida**. Filtros: `category` (slug), `city`, `urgency`, `q`, `compatible=true`, `page`, `pageSize`. Compatíveis primeiro, depois os mais recentes. |
| `GET /api/v1/provider/orders/{id}` | Detalhe. Visível enquanto o pedido está aberto, ou depois para quem enviou proposta; senão 404. `open` diz se ainda recebe propostas. |
| `POST /api/v1/provider/orders/{id}/proposals` | Envia proposta: `value`, `deadlineDays` (1 a 365), `description` (10 a 2000), `warranty` (3 a 200, obrigatória). 409 se o pedido não recebe mais propostas ou já há proposta deste prestador. |
| `GET /api/v1/provider/proposals` | Minhas propostas, com `status` (`Sent`, `Viewed`, `Chosen`, `NotChosen`), `q` e paginação; a resposta traz `counts` por status. |
| `GET` · `PATCH` · `DELETE /api/v1/provider/proposals/{id}` | Detalhe, edição e retirada. Só enquanto `Sent` ou `Viewed` e o pedido aberto; senão 409. Retirar apaga a proposta e permite propor de novo. |

### Compatibilidade

Um pedido é **compatível** com o prestador quando (1) a categoria do pedido (`escopo.categoria`) corresponde ao nome/código de uma especialidade ativa vinculada ao fornecedor **e** (2) a localização do pedido (`escopo.localizacao`) contém a cidade principal do perfil. A comparação ignora acentos, maiúsculas e diferenças de separadores. Pedidos não compatíveis continuam no feed geral, sem destaque.

Enviar proposta exige compatibilidade e pedido de outro usuário, aberto e sem proposta escolhida. A localização atual é textual; o raio em quilômetros não calcula distância geográfica.

### Privacidade do contratante

O prestador vê do contratante **só o primeiro nome**. Endereço completo, telefone, e-mail e CPF nunca saem nestas rotas.

## Aceite de proposta (contratante)

`POST /api/v1/orders/{id}/proposals/{proposalId}/accept` marca a proposta como `Chosen` e as demais pendentes do pedido como `NotChosen`. O pedido **continua `Pending`**: ele só entra em andamento depois do pagamento. Responde com o pedido atualizado. 409 quando o pedido não está mais aberto, já tem proposta aceita ou a proposta não está disponível; 404 para inexistentes ou de outro usuário.

Na Home do contratante, `proposals.awaitingDecision` passa a contar só propostas ainda pendentes (`Sent` ou `Viewed`) em pedidos abertos.
