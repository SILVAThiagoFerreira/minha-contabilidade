# Recuperação de acesso

## Fluxo implementado

O login oferece **Esqueci minha senha**. A pessoa informa o usuário e o Apps
Script consulta o e-mail salvo no perfil do cofre. Sem e-mail cadastrado, a
interface informa explicitamente que aquele usuário não possui e-mail de
verificação. Para contas inexistentes ou inativas, a resposta é neutra para
reduzir enumeração de usuários.

Quando houver e-mail, o backend cria um token aleatório, guarda apenas seu hash
em `PasswordResets`, limita pedidos repetidos por usuário e envia um link de
uso único que expira em 30 minutos. O token nunca é colocado em planilha ou
log em texto puro. A confirmação valida hash, validade e uso anterior antes de
trocar o verificador de senha com um novo salt.

Configure `APP_PUBLIC_URL` nas Script Properties com a URL pública do site
(sem dados privados). Depois de atualizar `backend/Code.gs`, publique uma nova
versão do Web App para autorizar o `MailApp` e servir as ações
`request-password-reset` e `confirm-password-reset`.
