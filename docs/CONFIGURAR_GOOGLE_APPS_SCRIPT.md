# Ativar login Google e armazenamento no Drive

O GitHub Pages continua hospedando somente a interface. Os dados financeiros ficam no Google Apps Script, em uma planilha criada dentro da pasta do Drive informada para o projeto:

`https://drive.google.com/drive/folders/1ceGgC-XicdMzxX9-__6oBKhHtkahoUk1`

O endereço da pasta não é uma credencial. O que protege os dados é a combinação de Google Login, Apps Script executando como o proprietário e uma pasta com acesso restrito.

## 1. Confirme a privacidade da pasta

Antes de usar dados reais, abra **Compartilhar** na pasta e deixe o acesso geral como **Restrito**. A pasta e a planilha não podem estar compartilhadas com outros usuários que não possam ver toda a contabilidade.

O filtro feito pelo aplicativo impede que uma conta Google leia a linha de outra conta pela interface. Ele não impede que alguém que tenha acesso direto à planilha abra o arquivo no Drive. Por isso, uma pasta compartilhada com terceiros não serve para garantir isolamento financeiro.

## 2. Criar o backend no Apps Script

1. Abra [script.google.com](https://script.google.com/) com a mesma conta proprietária da pasta.
2. Crie um projeto e copie o conteúdo de [`backend/Code.gs`](../backend/Code.gs).
3. Em **Configurações do projeto → Propriedades do script**, crie:

| Propriedade | Valor |
|---|---|
| `DRIVE_FOLDER_ID` | `1ceGgC-XicdMzxX9-__6oBKhHtkahoUk1` |
| `GOOGLE_CLIENT_ID` | client ID OAuth da aplicação Web |
| `ALLOWED_EMAILS` | opcional; e-mails separados por vírgula |

`SPREADSHEET_ID` é opcional. Se ficar vazio, o script cria automaticamente **Minha Contabilidade - Banco** dentro da pasta e cria as abas de armazenamento na primeira chamada.

Não salve token, senha ou segredo OAuth no código do GitHub. O client ID web pode aparecer no frontend; o client secret nunca deve aparecer.

## 3. Criar o client ID Google

No Google Cloud Console:

1. Selecione ou crie um projeto.
2. Configure a tela de consentimento OAuth para uso externo/pessoal.
3. Crie uma credencial **OAuth Client ID → Aplicativo da Web**.
4. Adicione como origem JavaScript autorizada:

```text
https://silvathiagoferreira.github.io
```

Use esse valor em `GOOGLE_CLIENT_ID` no Apps Script e em `config.js` no repositório.

## 4. Publicar o Web App

Em **Implantar → Nova implantação → Aplicativo da Web**:

- executar como: **eu / sua conta**;
- quem tem acesso: **qualquer pessoa com conta Google**;
- copie a URL que termina em `/exec`.

O Apps Script valida o token no endpoint oficial do Google, verifica emissor, audiência, validade, e-mail verificado e, se preenchido, a lista `ALLOWED_EMAILS`. O identificador de partição é o `sub` estável da conta Google; o e-mail é guardado apenas como atributo auxiliar.

## 5. Ligar o frontend

Edite `config.js`:

```js
window.FINANCE_CONFIG = Object.freeze({
  apiUrl: "https://script.google.com/macros/s/SEU_DEPLOYMENT_ID/exec",
  googleClientId: "SEU_CLIENT_ID.apps.googleusercontent.com"
});
```

Depois, publique a alteração no GitHub Pages. O botão **Entrar com Google** aparecerá no login. O modo local com senha continua disponível como fallback, mas ele fica preso ao navegador e não substitui o armazenamento online.

## Como a recuperação funciona

Cada sincronização remota é gravada nesta ordem:

1. `VaultJournal`: adiciona uma nova linha sem apagar revisões anteriores;
2. `VaultCurrent`: atualiza o estado corrente daquele `sub`;
3. pasta do Drive: cria um snapshot JSON novo, sem sobrescrever o anterior.

O backend usa `LockService` para serializar gravações, calcula SHA-256 do payload e verifica o checksum ao ler. Se o estado corrente estiver corrompido, a última revisão válida do journal é devolvida. Uma revisão otimista também bloqueia que uma aba antiga sobrescreva uma alteração feita em outro dispositivo.

O histórico de versões da própria planilha e os snapshots do Drive acrescentam camadas de recuperação. Os snapshots não são apagados automaticamente. Mesmo assim, nenhum fornecedor ou sistema oferece chance matemática zero de perda; para dados importantes, mantenha também uma exportação periódica em outra conta ou mídia offline.

## Limites de privacidade

O Apps Script e o proprietário da planilha conseguem ler o JSON armazenado. O login Google autentica e separa usuários, mas não é criptografia ponta a ponta. Se for necessário impedir a leitura até do proprietário do backend, será preciso adicionar uma senha-mestra/chave de recuperação e criptografar o payload no navegador antes do envio.

Não coloque dados reais em `config.js`, no repositório ou no GitHub Pages. A planilha, o journal e os snapshots devem permanecer somente no Drive privado.
