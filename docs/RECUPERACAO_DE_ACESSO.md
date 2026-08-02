# Recuperação de acesso

## Estado atual

O sistema possui troca de senha para usuários já autenticados. A recuperação por e-mail para quem não consegue entrar ainda não está ativada, pois ela exige um canal confiável de envio, tokens temporários com expiração e confirmação de propriedade do e-mail.

Não apresente uma recuperação de senha como concluída enquanto essas etapas não estiverem implementadas no Apps Script e verificadas em produção.

## Requisitos para ativação segura

1. Exigir e validar um e-mail de contato no perfil.
2. Gerar token aleatório de uso único, com hash e expiração curta armazenados no backend privado.
3. Enviar link de redefinição por provedor de e-mail configurado somente em propriedades privadas do Apps Script.
4. Confirmar o token antes de alterar salt e verificador da senha.
5. Invalidar o token após o uso e registrar a data de redefinição sem guardar senhas.

Até essa implantação, a troca de senha autenticada permanece o único fluxo seguro disponível.
