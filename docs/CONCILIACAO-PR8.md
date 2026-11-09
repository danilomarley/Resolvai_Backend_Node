# Conciliação do PR #8 — fornecedor e main

Integração local de `feat/migrar-fornecedor` (`b2ea012`) com `main` (`07eed23`).

Atualização em `feature/ajustar-cadastro-fornecedor`: o backend prioriza o modelo já existente de fornecedor. `categorias_servico`, `prestador_categorias` e `prestador_regioes` deixaram de ser dependências e foram retiradas dos scripts de criação. O catálogo é `especialidades`, os vínculos são `fornecedor_especialidades` e a cidade principal está em `fornecedores.cidade_atuacao`.

## Contratos finais

| Operação | Resultado |
| --- | --- |
| `POST /api/v1/auth/register` | Cadastro simples de Cliente: nome, e-mail e senha. |
| `POST /api/v1/auth/register-provider` | Cadastro completo de fornecedor PF/PJ, documento correspondente, contato e especialidades. O corpo simples antigo recebe 400. |
| `POST /api/v1/auth/check-email` | Solicita recuperação com resposta uniforme para contas existentes e ausentes. |
| `POST /api/v1/auth/reset-password` | Recuperação por OTP: `{email, token, newPassword}`. Código verificado antes da alteração. |
| `POST /api/v1/auth/forgot-password` | Recuperação por link: `{email, redirectTo}`. Origem autorizada e caminho `/redefinir-senha`. |
| `POST /api/v1/auth/change-password` | Bearer verificado e `{newPassword}`; alteração com a própria sessão, sem operação administrativa. |
| `/api/v1/fornecedores/me` | Perfil PF/PJ com uma cidade principal, UF e raio; `cidadesAtuacao` contém apenas essa cidade. |
| `POST /api/v1/fornecedores/me/complete-registration` | Conclusão completa da própria conta profissional já existente, com Bearer, sem criar outra identidade ou trocar credenciais. |
| `/api/v1/provider/profile` | Especialidades por código e exatamente uma cidade principal, diretamente no modelo de fornecedor. PJ com CNPJ pode concluir o perfil sem CPF. |
| Propostas de fornecedor/prestador | Duas entradas HTTP, regras compartilhadas: especialidade e cidade compatíveis, pedido aberto, sem proposta escolhida e de outro usuário. |
| Propostas do cliente | Consulta, ordenação, detalhe e aceite preservados, incluindo `NotChosen` para as demais propostas. |

O cadastro/login profissional mantém o papel interno `Prestador`. CPF é obrigatório para PF; PJ usa CNPJ. Perfis legados com CPF e categorias/regiões válidos continuam atendidos pelas rotas de prestador existentes.

Contas profissionais antigas sem registro em `fornecedores` podem concluir o perfil pela rota autenticada acima. O corpo contém os dados profissionais do cadastro completo, sem `email`, `password` ou UUID alvo. CPF já cadastrado é preservado; documento divergente ou perfil já existente retorna 409. Não há criação ou alteração de conta no Auth nesse fluxo.

`cidadesAtuacao` é opcional para compatibilidade; quando informada, deve conter somente a mesma cidade de `cidadeAtuacao`. `cities` de `/provider/profile` deve conter exatamente uma cidade. Alterações nas duas APIs profissionais atualizam o mesmo registro de fornecedor e seus vínculos de especialidades, na mesma transação. Categorias de `/catalog/categories` usam código textual como `id`; `categoryIds` não recebe mais UUIDs.

Pedidos armazenam localização textual. A compatibilidade regional compara a cidade principal, ignorando acentos e maiúsculas; não calcula distância geográfica pelo raio em quilômetros. UF e raio permanecem no perfil.

## Propostas e dados antigos

O módulo `propostas-*` mantém as operações do cliente. O módulo `propostas-fornecedor-*` contém envio multipart, portfólio e repetição idempotente por `requestId`. Valores em centavos são convertidos para o valor monetário persistido; ambos os envios gravam `prazo_dias`.

Uma segunda proposta do mesmo prestador para o mesmo pedido retorna 409. Repetir o mesmo `requestId` e conteúdo recupera o registro existente. O mapper reconhece `NotChosen`, campos legados ausentes e garantia textual. A edição pela rota de prestador invalida o hash anterior; trocar a garantia textual limpa a estrutura antiga para evitar respostas divergentes.

A retirada remove objetos de portfólio somente após confirmar a transação e apenas dentro do namespace da própria proposta. Falha de Storage mantém objetos para limpeza posterior; resultado incerto de COMMIT preserva as fotos.

## Banco inspecionado e migração preparada

A consulta de metadados no projeto Supabase `ResolvAi - database` confirmou:

- `fornecedores`, `especialidades`, `fornecedor_especialidades`, campos estendidos de propostas e `UNIQUE(cpf, role)` já existem.
- O histórico registra `20261108175920_expand_propostas_form`.
- Ainda faltam avaliações, `prazo_dias`, `nao_escolhida` e os índices de unicidade de propostas. As antigas tabelas paralelas de categorias/regiões não são mais necessárias.
- A consulta agregada não encontrou pares pedido/prestador duplicados nem pedidos com várias propostas escolhidas.

A consulta foi somente leitura. A migração preparada localmente é:

`supabase/migrations/20261109014627_reconcile_fornecedor_prestador.sql`

O arquivo `supabase/migrations/20261108175920_expand_propostas_form.sql` recupera a migração já registrada no histórico remoto, com o SQL original. Ele alinha o histórico local e não deve ser reaplicado manualmente no banco existente. A conciliação é a próxima migração.

Ela acrescenta os requisitos ausentes de avaliações/propostas e converte prazos textuais reconhecidos para dias, preservando os dados. Não cria catálogos/vínculos/regiões paralelos, não faz cópia de especialidades entre tabelas e não altera o cadastro de cidades. Usa transação e operações repetíveis. Duplicidades que surgirem antes da aplicação fazem a migração falhar e reverter, preservando os registros para análise. Login, perfil e oportunidades foram testados no schema atual sem essa migração.

Antes de publicar, conferir novamente o schema/histórico e aplicar esta migração pelo processo de banco adotado pelo projeto. Não reaplicar em massa os scripts históricos 013–016. A API não executa SQL de migração na inicialização.

## Consumidores

O fornecedor que já envia cadastro completo mantém `/auth/register-provider`. Consumidores do antigo cadastro simples de prestador precisam enviar os campos profissionais completos. Clientes seguem usando `/auth/register`.

O frontend de fornecedor que enviava Bearer para `/auth/reset-password` precisa usar `/auth/change-password`. `/auth/reset-password` fica reservado ao contrato OTP. Para oferecer os dois modos de recuperação no mesmo projeto, o template de recuperação do Supabase precisa apresentar o código `{{ .Token }}` e o link `{{ .ConfirmationURL }}`; a URL de retorno deve estar autorizada no Auth e em `CORS_ALLOWED_ORIGINS`.

As alterações desta entrega ficam no backend local. Publicação, mudanças no frontend e aplicação da migração remota são etapas posteriores.

## Validação

Os testes usam PostgreSQL PGlite isolado e Auth/Storage sintéticos. Cobrem evolução do schema do PR, repetição da migração, preservação de dados, perfil PJ, edição cruzada de perfil, autorização, OTP/link, propostas entre as APIs, idempotência, status, prazos e portfólio. Entrega de e-mail, interface de frontend e concorrência em PostgreSQL remoto não são exercitadas por essa suíte local.

| Verificação local | Resultado |
| --- | --- |
| `npm.cmd test` | 219 testes aprovados, zero falhas após a unificação no modelo de fornecedor. |
| `npm.cmd run typecheck` | Aprovado. |
| `npm.cmd run build` | Aprovado. |

O merge local fica resolvido e preparado para revisão, sem criar commit ou fazer push. A aplicação da migração remota e os ajustes de consumidores descritos acima permanecem para a publicação coordenada.
