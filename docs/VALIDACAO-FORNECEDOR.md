# Integração do fornecedor — validação e entrega

Concluída em 06/11/2026. As alterações permanecem em branches locais, sem merge, push ou deploy.

| Repositório | Branch | Base e versão do código validado |
| --- | --- | --- |
| Backend Node | `feat/migrar-fornecedor` | `main` em `3cdfc78`; código em `56a2cbc` |
| Frontend | `feat/ajustar-cadastro` | `dev` local e atualização de `origin/dev` em `96459df`; código em `80acd61` |

O frontend continua diretamente na raiz de `Resolvai_Fornecedor`. A atualização da `dev` preserva os recursos que já existiam nela.

## Escopo entregue

- Autenticação por UUID confirmado, conta local ativa, papel `Prestador` e existência do perfil profissional.
- Troca de senha restrita ao dono de um Bearer válido; consulta pública de e-mail sem revelar existência de contas.
- Cadastro profissional PF/PJ, validação de CPF/CNPJ numérico ou alfanumérico, telefone, UF, raio e especialidades ativas.
- Persistência transacional de usuário, fornecedor, contato e especialidades; edição profissional também transacional.
- Criação de conta externa sem substituir a senha de uma conta pendente existente. A política atual de signup/e-mail é consultada e respeitada; confirmações usam reenvio sem nova senha. Retomadas exigem autenticação comprovada.
- Cadastro, login, sessão renovável, controle de acesso e leitura/edição do perfil integrados no frontend.
- Sessão lembrada sincronizada entre abas, proteção contra respostas antigas, cancelamento de login abandonado e preservação do formulário durante renovação.
- Remoção/substituição de especialidades antigas desativadas e orientação condicional de confirmação de e-mail após cadastro.

Uploads de documentos, portfólio, novas oportunidades, propostas e aprovação manual não foram implementados. As métricas e os fluxos demonstrativos preexistentes fora dessa integração permanecem como estavam.

Contratos e configuração estão em [PROVIDER-REGISTRATION.md](PROVIDER-REGISTRATION.md), [README do backend](../README.md) e no README do frontend.

## Verificações executadas

| Projeto | Comandos | Resultado |
| --- | --- | --- |
| Backend | `npm.cmd test`, `npm.cmd run typecheck`, `npm.cmd run build`, `git diff --check` | 115 testes aprovados; demais verificações aprovadas |
| Frontend | `npm.cmd test`, `npm.cmd run lint`, `npm.cmd run build`, `git diff --check` | 70 testes aprovados; demais verificações aprovadas |

Os testes do backend usam PostgreSQL em memória via PGlite e o driver `pg`, além de HTTP de Auth simulado. Cobrem autorização, validações, duplicidades, rollback, edição persistida, conta pendente, resultados incertos e preservação da senha original. A entrega real de SMTP não foi exercitada.

Os testes do frontend cobrem os serviços reais, armazenamento, renovação, cancelamento, troca de identidade, respostas atrasadas e especialidades desativadas. Dois testes executam os componentes reais `ProviderGuard` e `ProviderProfilePage` por reconciliação React, incluindo edição não salva, renovação, PATCH pendente e recusa de acesso.

Foi feita ainda uma verificação HTTP entre os serviços reais do frontend e a aplicação Node, com `pg`/PGlite e Auth sintético:

| Operação | Resultado observado |
| --- | --- |
| Cadastro e catálogo pelos serviços do frontend | Cadastro 201 e seis especialidades |
| Login profissional / senha incorreta | 200 / 401 |
| Leitura, edição e nova leitura do perfil | Dados confirmados e persistidos |
| Perfil e troca de senha sem autenticação | 401 |
| Tentativa de alterar campo imutável | 400 |
| Renovação pelo cliente após expiração | 200 com rotação do refresh token |
| Logout com refresh de outro cliente em andamento | Sessão não restaurada; novo cliente permanece sem autenticação |
| CORS e armazenamento não relacionado | Origem correta; dados locais de pedidos preservados |

As revisões de tarefa e a revisão conjunta tiveram suas observações corrigidas. A revisão final das correções foi aprovada, sem achados críticos, importantes ou menores pendentes.

## Decisões tomadas

Esta lista preserva, na ordem, as decisões registradas durante a execução.

| Decisão | Motivo | Impacto se outra escolha for desejada |
| --- | --- | --- |
| Trabalhar nos dois checkouts e nas branches solicitadas | O usuário definiu os nomes, as bases e o workspace | Isolamento adicional exige abrir outro worktree; o trabalho está preservado |
| Executar backend e frontend em sequência, com revisão por etapa | Validar o contrato antes de integrar seu consumidor | Houve custo de execução/revisão adicional, sem mudança no contrato do produto |
| Proteger a troca de senha por Bearer e tornar a consulta de e-mail uniforme | Fechar a alteração anônima de senha por conhecimento do e-mail | Clientes do antigo reset público precisam seguir um fluxo autenticado/verificado |
| Não reutilizar credenciais expostas do repositório antigo nem criar contas reais nos testes | Preservar contas e dados; usar PGlite e Auth sintético | A conexão e a entrega de e-mail reais ainda precisam de configuração privada e validação própria |
| Incorporar os quatro commits que faltavam da `origin/dev` | Preservar cadastro e telas que já estavam implementados na versão remota da base | Uma entrega baseada estritamente na `dev` local antiga exigiria separar essa atualização |
| Usar criação administrativa apenas para contas novas, respeitando settings e confirmação | O signup público repetido pode substituir a senha de conta não confirmada | Requer as credenciais de servidor já previstas; falhas de settings/SMTP são tratadas sem ignorar a política |
| Manter as branches locais, conforme o escopo pedido | Publicação e integração nas bases não foram solicitadas | Push, PR, merge e deploy permanecem como passos separados |

## Execução e limites

A conexão existente com o banco criado foi mantida: `pg` usa `DATABASE_URL` e SSL; o Supabase Auth usa as variáveis `SUPABASE_*`. Nenhum banco novo foi criado e nenhuma alteração foi aplicada ao Supabase remoto. Os SQLs profissionais versionados são referências; não devem ser reaplicados automaticamente no banco existente.

Nesta cópia local, o backend ainda não tem `.env`. O README e `.env.example` descrevem as variáveis, mas não contêm os valores privados. Para iniciar a API real, configure esse arquivo e execute `npm.cmd run dev` em `Resolvai_Backend_Node`; a porta padrão é `5172`. O proxy Vite encaminha `/api` para essa API. Uma API publicada pode ser configurada por `VITE_API_BASE_URL` no frontend.

O frontend principal foi mantido em `http://127.0.0.1:5173/`. Os servidores temporários de teste nas portas `5174` e `5182` foram encerrados após a validação; eles usavam apenas dados sintéticos em memória.

A validação visual pelo navegador foi interrompida pela ferramenta porque ela não conseguiu identificar com segurança a URL atual no Windows. Os testes de componentes não representam uma aprovação visual de layout/responsividade.

Aviso conhecido dos testes: `react-test-renderer@19.2.8` é uma dependência de desenvolvimento fixada e emite aviso de depreciação. Ele foi mantido visível, sem suprimir erros React ou avisos de `act`. Não integra o bundle de produção e foi considerado contexto de manutenção não bloqueante na revisão.

Auth e PostgreSQL continuam sendo sistemas separados, sem transação distribuída. Os limites de tentativas são locais a cada instância. Configurações privadas de CAPTCHA/hooks, entrega real de e-mail e ambiente publicado não foram validados por esses testes sintéticos.
