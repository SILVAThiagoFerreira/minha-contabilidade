# Configurar o armazenamento na planilha e na pasta do Drive

O GitHub Pages hospeda somente a interface. O Apps Script executa como o proprietário da pasta, grava a contabilidade na planilha e cria snapshots JSON na mesma pasta.

O aplicativo usa apenas o usuário e a senha locais da tela de entrada. Não há login Google, client ID ou validação de conta Google no frontend ou no backend.

## 1. Configurar a pasta e a planilha

Na conta proprietária do Drive:

1. Use a pasta escolhida para o projeto.
2. Deixe o acesso da pasta como **Restrito**.
3. Se já existir uma planilha para o banco, informe seu ID na propriedade `SPREADSHEET_ID`.
4. Se `SPREADSHEET_ID` ficar vazio, o script cria automaticamente **Minha Contabilidade - Banco** dentro da pasta.

O ID da pasta não fica no frontend, no `config.js` ou no artefato publicado do Pages. Ele fica somente nas propriedades privadas do Apps Script.

## 2. Publicar o backend

1. Abra [script.google.com](https://script.google.com/) com a conta proprietária da pasta.
2. Crie ou abra o projeto **Minha Contabilidade - Backend**.
3. Copie o conteúdo de [`backend/Code.gs`](../backend/Code.gs).
4. Em **Configurações do projeto → Propriedades do script**, configure:

| Propriedade | Valor |
|---|---|
| `DRIVE_FOLDER_ID` | ID da pasta escolhida no Google Drive |
| `SPREADSHEET_ID` | Opcional; ID da planilha existente |
| `SPREADSHEET_NAME` | Opcional; padrão `Minha Contabilidade - Banco` |

Em **Implantar → Nova implantação → Aplicativo da Web**:

- executar como: **eu / proprietário da pasta**;
- quem tem acesso: **qualquer pessoa**;
- copie a URL que termina em `/exec`.

Na primeira autorização do Apps Script, o proprietário precisa permitir o acesso do script ao Drive e ao Sheets. Isso é a autorização do próprio backend para gravar os arquivos; não é login Google no aplicativo.

## 3. Ligar o frontend

Edite `config.js` com a URL `/exec`:

```js
window.FINANCE_CONFIG = Object.freeze({
  apiUrl: "https://script.google.com/macros/s/SEU_DEPLOYMENT_ID/exec"
});
```

Depois, publique a alteração no GitHub Pages. O login continua sendo feito com usuário e senha locais. Ao entrar ou criar uma conta, o aplicativo consulta a planilha; as alterações seguintes são sincronizadas automaticamente.

Se `apiUrl` ficar vazio, o sistema continua funcionando no modo local, mas os dados ficam somente no navegador.

## 4. Como os dados são separados

O frontend calcula um identificador estável a partir do nome de usuário local. O Apps Script usa esse identificador para encontrar a linha correta; a senha não é enviada nem armazenada na planilha.

As chamadas usam este contrato:

```json
{
  "action": "get",
  "accountId": "hash-do-usuario",
  "username": "thiago"
}
```

```json
{
  "action": "sync",
  "accountId": "hash-do-usuario",
  "username": "thiago",
  "payload": {},
  "baseRevision": 3
}
```

O backend valida o formato do identificador e do usuário antes de acessar a planilha. O isolamento entre usuários é uma convenção do login local; o endpoint não usa OAuth.

## 5. Recuperação e cópias

Cada sincronização é gravada nesta ordem:

1. `VaultJournal`: adiciona uma nova linha sem apagar revisões anteriores;
2. `VaultCurrent`: atualiza o estado corrente daquele usuário;
3. pasta do Drive: cria um snapshot JSON novo, sem sobrescrever o anterior.

O backend usa `LockService`, calcula SHA-256 do payload e verifica o checksum ao ler. Se o estado corrente estiver corrompido, a última revisão válida do journal é devolvida. O controle de `baseRevision` evita que uma aba antiga sobrescreva uma alteração mais nova por acidente.

Os snapshots não são apagados automaticamente. O aplicativo também mantém exportação manual em JSON na tela de configurações.

## 6. Observações práticas

- O JSON armazenado pelo Apps Script fica legível para o proprietário da planilha.
- A URL do endpoint precisa estar no `config.js` para o site sincronizar.
- Não coloque o ID da pasta, a URL da planilha ou dados financeiros no repositório.
- Se a planilha antiga tiver dados criados pelo fluxo Google anterior, exporte esses dados e importe-os na conta local desejada; os identificadores antigos não são os mesmos do login local.
