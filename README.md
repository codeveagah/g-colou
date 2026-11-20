# G-Colou

Chegou código de verificação no Gmail? Ele aparece num card no canto da página que você está usando. Um clique e está copiado. Sem abrir o Gmail.

**100% local:** a extensão lê o Gmail com o login que você já tem neste Chrome. Nenhum e-mail, código ou dado sai do seu navegador. Não tem servidor, conta, nem rastreamento.

## Como instalar (amigos testando)

1. Baixe o projeto: botão verde **Code → Download ZIP** e descompacte numa pasta que você não vai apagar.
2. No Chrome, abra `chrome://extensions`.
3. Ligue o **Modo do desenvolvedor** (canto superior direito).
4. Clique em **Carregar sem compactação** e escolha a pasta descompactada (a que tem o `manifest.json`).
5. Esteja logado no Gmail neste Chrome. Pronto.

Para testar: peça um código de verificação em qualquer site (ex.: login do Spotify) e espere o card aparecer.

## Como funciona

- Enquanto a aba está aberta, a extensão olha os e-mails **não lidos** que chegaram nos **últimos 5 minutos** (a cada 2 s se a página tem campo de código, a cada 10 s no resto).
- Achou um código, mostra o card: "Vitor, chegou seu código · 482913 · de YouTube". Clique copia. O card some em 2 minutos.
- **Borda laranja:** o código veio de uma empresa diferente do site aberto (o card mostra de onde veio). Precisa de dois cliques para copiar. Confira antes de usar: pode ser site falso.
- Ícone com **!**: você não está logado no Gmail neste Chrome.
- Só roda em sites `https://`.

## Opções

Clique no ícone da extensão:
- **Ligado / desligado**, com prévia do card
- **Seu nome** (aparece no card)
- **Copiar automaticamente** (desligado por padrão; só copia sozinho se o remetente bate com o site)
- **Lado da tela** (esquerda ou direita)

## Limites da v0.1

- Lê só a conta principal do Gmail no Chrome (`/u/0`) e só a caixa de entrada.
- Só e-mails não lidos: se você abrir o e-mail antes, o card não aparece.
- Usa a prévia do e-mail (~200 caracteres). Código escondido no fim de e-mail longo pode não ser achado.
- Depende do feed Atom do Gmail, que não é oficial: o Google pode mudar ou desligar.

## Privacidade

- Permissões: ler `mail.google.com` (o feed), guardar suas opções, copiar para a área de transferência, e mostrar o card nos sites que você abre.
- Guarda só os ids dos e-mails já vistos/usados (para não mostrar de novo). O código fica só na memória da sessão por 2 minutos e nunca é gravado em disco.

## Desenvolvimento

```
npm test
```

Testes do extrator de código e da checagem de domínio em `test/lib.test.js` (Node 20+, sem dependências).
