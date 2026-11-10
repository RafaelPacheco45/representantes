# Revisão do portal de representantes

## Correções
- Textos JavaScript recuperados para UTF-8, sem alterar condições comerciais do contrato oficial.
- Contrato HTML tratado como documento, sem exibir head, CSS ou scripts; tipografia isolada das regras dos cards.
- Cadastro e login protegidos de submissões duplicadas. Aceite só aparece confirmado após resposta válida da API.
- Cadastro parcialmente concluído pode retomar o aceite sem criar outra conta, inclusive após recarregar ou entrar novamente.
- Painel exige sessão e contrato confirmado; validação de nome, e-mail e idade no formulário.
- Falhas no envio da foto são informadas; chave CPF PIX mascarada também quando recebida sem pontuação.

## Verificações
`npm ci && npm run check`: sintaxe e 15 testes de DOM/fluxo com API simulada, incluindo contrato, HTML inseguro, respostas fora de ordem, cadastro, retomada, login, treinamento, painel, indicação/QR e máscara PIX.

## Limitações
- Testes não criam usuários, aceites jurídicos, leads ou pagamentos reais.
- Chromium não iniciou neste ambiente por restrição de sandbox; não houve inspeção visual de screenshot.
- Backend requer revisão separada de autenticação e isolamento das contas de representantes. Esta alteração frontend não corrige vulnerabilidades do servidor.
- Nome digitado e idade são validados no navegador; validação/persistência no servidor deve ser avaliada separadamente.
- Não houve avaliação jurídica do contrato nem confirmação de conversão comercial/pagamento real.
- Commit e PR não comprovam implantação em produção.
