# Administração do sistema

O painel administrativo é disponibilizado somente pelo backend após uma
autenticação válida de uma conta com papel `admin`. O navegador não decide
papéis e nunca recebe hashes, senhas, e-mails ou o conteúdo financeiro dos
cofres de outros usuários.

## Provisionar o primeiro administrador

No projeto privado do Apps Script, abra **Configurações do projeto >
Propriedades do script** e defina temporariamente:

| Propriedade | Valor |
| --- | --- |
| `ADMIN_USERNAME` | identificador do administrador |
| `ADMIN_PASSWORD` | senha forte, usada uma única vez |
| `ADMIN_DISPLAY_NAME` | nome exibido (opcional) |

No editor do Apps Script, execute `provisionAdminFromScriptProperties` com a
conta proprietária do projeto. A função cria ou atualiza apenas esse usuário,
atribui o papel administrativo e elimina `ADMIN_PASSWORD` ao terminar. Remova
também as demais propriedades temporárias quando não forem mais necessárias.

Nunca adicione a senha, o ID da planilha, links de armazenamento ou exportações
financeiras ao repositório público.

## Promover uma conta existente

Para conceder acesso administrativo a uma conta que já existe sem alterar sua
senha, defina temporariamente `ADMIN_PROMOTE_USERNAME` nas Script Properties e
execute `promoteExistingAdminFromScriptProperties`. A função altera somente o
papel para `admin` e remove a propriedade temporária ao concluir.

## Dados retornados ao painel

A ação administrativa retorna somente indicadores agregados do sistema:
usuários ativos/inativos, administradores, cofres existentes, revisões,
quantidades de lançamentos, contas e investimentos, além da data da última
atualização. A lista de usuários contém apenas identificador, nome exibido,
papel, status e datas de criação/atualização. Ela não retorna senhas,
verificadores, e-mails, fotos ou registros financeiros.

O backend cria a aba `AccessLog` para registrar somente identificador técnico,
data e tipo de acesso após login ou cadastro bem-sucedido. Esses eventos geram
o total e a série mensal de visitas do painel; não registram saldos, conteúdo
do cofre, senha, e-mail ou foto.

Depois de alterar o Apps Script, crie uma nova versão e atualize a implantação
do Web App para que o endpoint público passe a executar o código novo.
