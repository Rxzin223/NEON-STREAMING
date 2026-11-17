# NEON STREAMING

Versão estática do catálogo de animes para publicar no **GitHub Pages**. Os vídeos permanecem no Google Drive; o site autentica o usuário no próprio navegador e transmite os arquivos por solicitações parciais, sem baixar o MP4 inteiro para a memória.

## Publicar no GitHub Pages

1. Envie o conteúdo desta pasta para a raiz do repositório GitHub, incluindo `public/` e `.github/workflows/pages.yml`. **Não envie `.env`, arquivos JSON de credenciais OAuth, tokens ou client secrets.**
2. No Google Cloud Console, ative a **Google Drive API** e configure a tela de consentimento OAuth. Para uma conta pessoal, use o tipo de usuário compatível com sua conta e adicione sua conta à lista de usuários de teste quando o app estiver em teste.
3. Crie ou reutilize um OAuth Client ID do tipo **Aplicativo da Web**. Em **Authorized JavaScript origins**, adicione:
   - `http://localhost:4173` para testar localmente;
   - `https://SEU-USUARIO.github.io` para o GitHub Pages.

   Use apenas a origem: **não** acrescente o caminho `/nome-do-repositorio`.
4. Abra `public/config.js` e substitua `COLE_SEU_CLIENT_ID.apps.googleusercontent.com` pelo Client ID. Client IDs OAuth de aplicativos web são identificadores públicos; não coloque um `client_secret` nesse arquivo.
5. No GitHub, abra **Settings → Pages**, escolha **GitHub Actions** como origem. O workflow `Publicar no GitHub Pages` envia o conteúdo de `public/` e publica o site após um push para `main` ou `master`.
6. Abra o endereço exibido em **Settings → Pages**, conecte a conta Google e compartilhe com ela uma pasta do Drive contendo episódios MP4.

## Testar localmente

Na raiz desta pasta, execute `node server.js` e abra `http://localhost:4173`. O arquivo `.env` não é necessário para o login desta versão estática; o Client ID fica em `public/config.js`.

## Como funciona e limitações

- O OAuth usa somente `https://www.googleapis.com/auth/drive.readonly`. O token de acesso fica no IndexedDB do navegador e é usado pelo Service Worker para enviar pedidos de vídeo com suporte a `Range`; os vídeos não são armazenados pelo site.
- O catálogo de obras, favoritos e progresso ficam no armazenamento local de **cada navegador**. Não existe conta NEON nem sincronização entre aparelhos nesta versão estática.
- Cada usuário precisa conectar uma conta Google com permissão para ler os arquivos. O catálogo adicionado por um navegador não aparece automaticamente para outros usuários. Compartilhar um catálogo comum exigiria um backend ou um banco de dados.
- A lista considera arquivos MP4 diretamente dentro da pasta escolhida; a ordem usa os nomes dos episódios com ordenação numérica natural.
- A Google Drive API e o OAuth precisam estar corretamente configurados. Se o app OAuth estiver em modo de teste, somente os usuários de teste podem autorizar a conexão.
