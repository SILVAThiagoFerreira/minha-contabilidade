# Política de segurança

## Escopo

O GitHub Pages deste projeto é público somente para entregar a interface. O cofre financeiro, credenciais, identificadores de planilha, links de recursos do Drive, exports e cópias operacionais não pertencem ao repositório nem ao artefato público.

## Controles atuais

- a sessão do navegador é mantida apenas em memória durante a página aberta;
- a autenticação e a validação de dados são executadas pelo Apps Script;
- o identificador da planilha é uma propriedade privada do Apps Script, não uma configuração do frontend;
- o histórico financeiro é mantido na planilha, separado do código publicado;
- arquivos e diretórios de operação privada são ignorados pelo Git.

## Práticas obrigatórias

- Nunca faça commit de URLs privadas, IDs de planilha ou Drive, JSONs de dados, relatórios financeiros, credenciais ou tokens.
- Use somente dados sintéticos em exemplos, capturas, testes e documentação pública.
- Revogue compartilhamentos indevidos no Drive e troque credenciais expostas antes de continuar a operação.
- Antes de publicar, confira os arquivos que serão enviados com `git diff --cached --name-only`.

## Relato responsável

Se identificar uma exposição de dados ou vulnerabilidade, não abra uma issue pública com evidências sensíveis. Comunique o proprietário do projeto por um canal privado, descrevendo o impacto e os passos de reprodução sem anexar dados reais.
