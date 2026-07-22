# Configurar o armazenamento online

O GitHub Pages hospeda somente a interface. O Apps Script executa como o proprietário da implantação, valida o cadastro e a senha e grava a contabilidade em uma única planilha online. O histórico das revisões fica na aba VaultJournal da mesma planilha.

Não existe modo local. O navegador não guarda contas, credenciais ou cofre em localStorage, sessionStorage, IndexedDB ou arquivos automáticos. A sessão fica apenas na memória enquanto a página está aberta.

## 1. Configurar a planilha

Use a planilha online escolhida como fonte oficial e mantenha o acesso dela restrito à sua conta. O ID não fica no frontend nem no artefato publicado do Pages; ele fica somente nas propriedades privadas do Apps Script.

## 2. Publicar o Apps Script

1. Abra script.google.com com a conta proprietária da planilha.
2. Abra o projeto Minha Contabilidade - Backend.
3. Copie o conteúdo de backend/Code.gs para o editor do Apps Script.
4. Em Configurações do projeto, abra Propriedades do script e configure:

| Propriedade | Valor |
| --- | --- |
| SPREADSHEET_ID | `1F29KEP0--zHP8YtgP_zui3GZUmHP_5NFDQGHWdSwqcI` |

Em Implantar, crie uma implantação como Aplicativo da Web:

- executar como: eu / proprietário da pasta;
- quem tem acesso: qualquer pessoa;
- copie a URL que termina em /exec.

Na primeira execução, o proprietário precisa autorizar o acesso do script ao Google Sheets. Essa autorização permite que o backend grave na planilha; não é uma tela de login do aplicativo.

## 3. Ligar o frontend

No arquivo config.js, informe a URL /exec na propriedade apiUrl. O arquivo já deve conter a URL da implantação ativa.

Depois, publique a alteração no GitHub Pages. O usuário cria a conta ou entra com usuário e senha; o Apps Script valida a credencial e devolve o cofre correspondente.

Sempre que `backend/Code.gs` mudar, crie uma nova versão da implantação do Web App e confirme que o frontend continua usando a URL `/exec` da implantação atual. O GitHub Pages publica apenas os arquivos estáticos e não substitui o código já implantado no Apps Script.

Se apiUrl estiver ausente, a tela bloqueia o uso e informa que o armazenamento online não foi configurado. O sistema nunca abre um modo alternativo local.

## 4. Abas e autenticação

O backend cria ou valida as seguintes abas:

- Users: accountId, username, displayName, salt, verifier, datas e status;
- VaultCurrent: uma revisão corrente por usuário;
- VaultJournal: histórico append-only de cada sincronização.

O JSON de cada usuário mantém as coleções `accounts`, `transactions`, `fixedCosts`, `debts`, `investments`, `cdbs` (espelho de compatibilidade) e `savings`. Os investimentos antigos em `cdbs` são lidos sem perda e passam a aparecer na aba Investimentos. Cada investimento pode manter `operations[]`, com operações `aporte`, `resgate` e `rendimento`; os dois primeiros tipos também marcam os lançamentos relacionados em `transactions` por meio de `investmentOperationId` e `investmentId`. O histórico é acrescentado ao snapshot e não substitui os dados anteriores da posição.

O frontend calcula o identificador do usuário para localizar o cadastro, mas o backend confirma o mesmo hash, procura o usuário na aba Users e verifica a senha com salt. O backend não aceita get ou sync sem uma senha válida. A senha é enviada apenas pela conexão HTTPS do Web App e nunca é gravada em texto puro; a planilha guarda apenas o salt e o verificador.

Para trocar a senha, a interface envia a senha atual na ação autenticada `change-password` e a nova senha no payload. O backend confere a senha atual antes de gerar outro salt e verificador, atualiza o registro correspondente em `Users` e não altera o cofre financeiro. A nova senha passa a ser usada pela sessão enquanto a página permanecer aberta.

O payload de cada usuário fica em uma célula JSON com limite operacional de 45.000 caracteres. O backend valida as coleções antes de gravar e usa checksum SHA-256 para detectar corrupção.

## 5. Recuperação e cópias

Cada sincronização é gravada nesta ordem:

1. VaultJournal recebe uma nova linha sem apagar revisões anteriores;
2. VaultCurrent recebe o estado corrente;
3. nenhuma pasta ou arquivo auxiliar é criado: o histórico permanece na própria planilha.

O backend usa LockService, controla a revisão base e rejeita uma gravação feita sobre uma versão antiga. Se o estado corrente estiver inválido, a última revisão válida do journal é promovida novamente para VaultCurrent antes de continuar.

Se VaultCurrent precisar ser recuperado, o backend usa a última revisão válida de VaultJournal. A planilha deve ser mantida como a fonte online oficial e, se desejar uma cópia manual adicional, faça-a pelo próprio Google Sheets, fora do fluxo automático do aplicativo.

## 6. Operação

- Depois de sair ou recarregar a página, faça login novamente.
- Uma conta criada em um dispositivo pode ser usada em outro porque o cadastro está na planilha.
- Em falha de rede ou indisponibilidade do Apps Script, a alteração não é apresentada como salva.
- Não coloque a URL completa da planilha ou dados financeiros no repositório.
- O JSON fornecido para referência não é importado nem alterado pelo aplicativo.
- Em `Configurações`, o usuário pode trocar a senha sem sair da conta; se a senha atual estiver errada, nenhum dado é alterado.
- Em `Análises`, o botão `Exportar relatório TXT` gera um relatório local para enviar a uma IA. O arquivo inclui dados registrados e cálculos derivados, mas não contém senha, salt, verificador ou `accountId` da autenticação.
