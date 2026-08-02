# Guia de contribuição

## Princípios

Mantenha o produto simples para o usuário e rigoroso para os dados: mudanças devem preservar o histórico, não recategorizar registros silenciosamente e não incluir informações privadas no código ou na documentação.

## Estrutura

- `index.html`, `styles.css`, `app.js` e `favicon.svg`: interface publicada.
- `config.js`: endpoint público do Web App, sem segredos ou identificadores de planilha.
- `backend/Code.gs`: regras do Apps Script e acesso ao armazenamento privado.
- `docs/`: arquitetura, operação e orientações públicas.
- `tests/validate.mjs`: contratos estáticos essenciais.

## Desenvolvimento

1. Trabalhe com dados de demonstração ou estruturas vazias.
2. Execute as verificações abaixo antes de preparar um commit:

```powershell
node --check app.js
Get-Content backend\Code.gs -Raw | node --check
node tests\validate.mjs
git diff --check
```

3. Faça staging apenas dos arquivos da mudança e inspecione o resultado:

```powershell
git diff --cached --name-only
git diff --cached --check
```

## Publicação

O código-fonte fica em `main`. A interface do GitHub Pages é atualizada manualmente na branch `gh-pages` apenas com `.nojekyll`, `index.html`, `styles.css`, `app.js`, `config.js`, `favicon.svg` e `release.json`. Backend, documentação, testes e recursos privados não são parte da publicação estática. Aumente a versão de `release.json` em toda publicação para que as abas abertas recebam o código novo automaticamente.

Depois do push, valide HTML, JavaScript e CSS servidos com uma consulta sem cache. Uma alteração em `backend/Code.gs` também exige publicar uma nova versão do Web App no Apps Script; o GitHub Pages não faz essa implantação.

## Conta de apresentação

Mantenha uma conta de apresentação separada, criada diretamente no backend privado e preenchida apenas com valores sintéticos. Em cada evolução que altere tela, cálculos, categorias ou dados exibidos, atualize também esse cofre de demonstração para que a apresentação continue representando a versão atual.

Nunca versione identificador, senha, e-mail, dados pessoais ou valores reais dessa conta. O provisionamento e a redefinição dos dados de demonstração acontecem fora do Git, com as permissões do Apps Script.
