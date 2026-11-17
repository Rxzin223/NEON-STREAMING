# NEON STREAMING

Aplicativo web em português para organizar e assistir episódios MP4 mantidos em pastas do Google Drive.

## Requisitos

- Node.js 20 ou superior.
- Um projeto no Google Cloud com a **Google Drive API** ativada.
- Um OAuth Client ID do tipo **Aplicativo da Web**.

## Configuração do Google Drive

1. No Google Cloud Console, ative a Google Drive API e configure a tela de consentimento OAuth.
2. Crie um OAuth Client ID para aplicativo web e adicione `http://localhost:4173` às origens JavaScript autorizadas. Se o aplicativo for publicado em outro endereço, adicione também a origem HTTPS correspondente.
3. Copie `.env.example` para `.env` e preencha `GOOGLE_CLIENT_ID` com o Client ID criado.
4. Se a tela OAuth estiver em modo de teste, adicione as contas Google que vão usar o app como usuários de teste.
5. Inicie o app:

   ```powershell
   node server.js
   ```

6. Abra `http://localhost:4173`, conecte a conta Google e compartilhe com ela uma pasta do Drive contendo os episódios MP4.
7. Em **Nova obra**, informe o título e cole o link da pasta (ou o ID). Sinopse e capa são opcionais. Os episódios precisam estar diretamente dentro da pasta; a ordem é definida pelos nomes dos arquivos, com ordenação numérica natural.

O NEON solicita somente acesso de leitura ao Drive. O servidor usa esse acesso para listar os episódios e transmitir o conteúdo com suporte a solicitações parciais (Range), sem copiar nem armazenar os vídeos. A pasta precisa estar acessível à conta conectada.

## Recursos

- Catálogo de obras com sinopse, capa e edição das informações.
- Reprodução com progresso retomável, barra de busca, pausa, tela cheia e saltos de 10 segundos.
- Duplo clique no lado esquerdo/direito do vídeo para voltar/avançar 10 segundos.
- Botão para pular a abertura, com tempo configurável por obra.
- Marcação como assistido depois de 3 minutos efetivamente reproduzidos.
- Favoritos, continuar assistindo, próximo episódio automático opcional e aviso ao terminar um episódio.

O catálogo é salvo em `data/catalog.json` no servidor. Favoritos e progresso ficam no armazenamento local do navegador usado para assistir. Em uma publicação para mais pessoas, use HTTPS e um servidor com armazenamento persistente para o catálogo; cada pessoa também precisa ter permissão de leitura dos arquivos do Drive.
