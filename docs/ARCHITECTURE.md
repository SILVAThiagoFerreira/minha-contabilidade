# Arquitetura

## Visão geral

O projeto separa interface, autenticação e armazenamento para que o GitHub Pages possa ser público sem carregar o cofre financeiro de ninguém.

```text
Usuário autenticado
        |
        v
GitHub Pages (HTML, CSS e JavaScript)
        |
        | HTTPS / API do Web App
        v
Google Apps Script (autenticação, validação e revisão)
        |
        v
Google Sheets privado (Users, VaultCurrent e VaultJournal)
```

## Limites de responsabilidade

- **Frontend:** renderiza a interface, mantém a sessão apenas na memória da página e solicita sincronização autenticada.
- **Apps Script:** valida credenciais, controla revisões concorrentes e aplica as regras de integridade do cofre.
- **Planilha:** é a fonte oficial dos dados e mantém o estado atual e o histórico append-only.
- **GitHub Pages:** entrega somente os arquivos estáticos necessários para o aplicativo; não recebe planilhas, exportações, cópias do cofre ou referências privadas do Drive.

## Dados e privacidade

Identificadores de planilhas, links de pastas, referências JSON e qualquer exportação financeira são configuração privada de operação. Eles ficam fora do Git e não devem aparecer no HTML, JavaScript, documentação pública ou artefato publicado.

Para registrar uma referência localmente, copie `OPERATIONS_PRIVATE.md.example` para `OPERATIONS_PRIVATE.md`. O arquivo de destino é ignorado pelo Git e o modelo não contém valores reais.

## Evolução segura

1. Altere o frontend ou backend com dados sintéticos.
2. Execute `node --check app.js`, a validação do backend e `node tests/validate.mjs`.
3. Publique o frontend na branch `gh-pages` somente com os ativos estáticos.
4. Para mudar o Apps Script, crie uma nova versão da implantação separadamente.
5. Verifique a versão servida do Pages com URLs sem cache antes de considerar a entrega concluída.
