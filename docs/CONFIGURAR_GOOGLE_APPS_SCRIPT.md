# Modo online com Google Sheets

O GitHub Pages hospeda apenas arquivos estáticos. Para ter sincronização entre dispositivos sem colocar dados pessoais no repositório, o projeto inclui um Web App opcional do Google Apps Script. A planilha fornecida pode ser usada como base: ela foi exportada para inspeção e está com uma aba vazia, portanto nenhum lançamento foi copiado ou inventado.

## Configuração

1. Abra a sua planilha no Google Sheets e entre em **Extensões → Apps Script**.
2. Copie o conteúdo de `backend/Code.gs` para o editor do Apps Script.
3. Em **Configurações do projeto → Propriedades do script**, crie:
   - `SPREADSHEET_ID`: o ID da planilha que vai armazenar os dados;
   - `GOOGLE_CLIENT_ID`: o ID do cliente OAuth criado no Google Cloud para a aplicação web.
4. Em **Implantar → Nova implantação → Aplicativo da Web**:
   - executar como: sua conta;
   - quem tem acesso: qualquer pessoa com conta Google;
   - copie a URL que termina em `/exec`.
5. No Google Cloud Console, cadastre o endereço do GitHub Pages como origem JavaScript autorizada para o mesmo client ID.
6. Edite `config.js` no repositório:

```js
window.FINANCE_CONFIG = Object.freeze({
  apiUrl: "https://script.google.com/macros/s/SEU_DEPLOYMENT_ID/exec",
  googleClientId: "SEU_CLIENT_ID.apps.googleusercontent.com"
});
```

7. Faça um novo commit e aguarde a publicação do Pages.

## Como os dados ficam isolados

O navegador envia um ID token do Google ao Web App. O Apps Script valida o token no endpoint oficial `tokeninfo`, confere o client ID e usa o e-mail verificado como chave da linha `Vault`. A aplicação nunca recebe a planilha inteira e não tem credencial administrativa para o Sheets.

Ainda assim, a privacidade depende de manter a planilha privada e de não compartilhar o Web App com contas que não devem usar o sistema. A coluna `payload` contém o cofre JSON de cada usuário; não publique uma cópia da planilha no repositório.

## Modo local

Se `apiUrl` e `googleClientId` estiverem vazios, o site continua funcionando no modo local protegido. Cada usuário tem uma conta separada no navegador e o cofre é criptografado com AES-GCM a partir da senha. Esse modo não sincroniza entre dispositivos; exporte um JSON em **Configurações** para fazer uma cópia manual.
