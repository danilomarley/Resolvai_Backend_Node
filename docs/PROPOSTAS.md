# Envio de propostas

`POST /api/v1/fornecedores/me/oportunidades/{id}/propostas` exige Bearer de
Prestador ativo com perfil. Recebe `multipart/form-data`, com um campo
`proposal` contendo JSON e de zero a cinco arquivos `portfolio` (JPG/PNG,
até 5 MB cada). MIME e assinatura são conferidos no servidor.

O JSON contém `requestId` (UUID estável por tentativa), `valueCents` (inteiro
positivo), `deadline`, `description`, `guaranteePeriod`, `guaranteeType` e os
opcionais `startDate` (YYYY-MM-DD), `materials`, `guaranteeConditions`.
Campos de identidade, status, descontos e URLs fornecidos pelo cliente são
rejeitados. O UUID do prestador vem exclusivamente do usuário autenticado.

O pedido precisa estar aberto, sem proposta escolhida e corresponder a uma
especialidade ativa do prestador. A condição é verificada novamente na
transação de gravação, com bloqueio do pedido e dos vínculos profissionais.

`016_expand_propostas_form.sql` acrescenta data de início, materiais,
garantia estruturada, portfólio JSON, hash de idempotência e data de criação.
Preserva valor, prazo, descrição e garantia textual, para compatibilidade
com as consultas de propostas dos clientes. RLS permanece habilitado e o
acesso continua pela API Node; nenhuma credencial privada vai ao frontend.

As imagens são gravadas no bucket configurado, sob
`propostas/{prestador}/{proposta}/{tentativa}/`. O JSON `portfolio` da tabela
contém URLs e nomes. Arquivos de uma tentativa descartada são removidos sem
atingir os arquivos de outras tentativas. Se o resultado do COMMIT for
incerto, o servidor tenta ler a proposta e preserva as fotos para não apagar
arquivos já referenciados. Uma falha simultânea de consulta pode deixar
arquivos temporários para reconciliação posterior.

A mesma tentativa e o mesmo conteúdo retornam o registro já salvo sem nova
proposta. Reutilizar o UUID com outros dados retorna 409. Não há repetição
automática por falha de rede. A tela mantém os dados de um envio incerto
bloqueados e permite verificar repetindo a mesma tentativa.

O retorno 201 inclui os dados persistidos e `Location` para
`GET /api/v1/fornecedores/me/oportunidades/{id}/propostas/{proposalId}`.
Essa consulta só permite ler a própria proposta, inclusive após encerramento
do pedido. O sucesso no frontend só aparece após uma resposta confirmada.

O valor salvo é o total informado; a prévia de taxa ilustrativa não gera
descontos, pagamentos, mensagens ou notificações. Testes de escrita usam banco
isolado. `scripts/verify-proposta-integration.mjs` verifica o ambiente real
com rollback obrigatório da proposta e remoção da imagem temporária criada.
