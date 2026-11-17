const DB_NAME = "neon-drive";
const STORE_NAME = "credentials";
const DRIVE_API = "https://www.googleapis.com/drive/v3/files/";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);
  const scopePath = new URL(self.registration.scope).pathname;
  const mediaPrefix = `${scopePath}drive-media/`;
  if (event.request.method !== "GET" || !requestUrl.pathname.startsWith(mediaPrefix)) return;

  event.respondWith(streamDriveFile(event.request, requestUrl.pathname.slice(mediaPrefix.length)));
});

function getCredentials() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onerror = () => reject(request.error || new Error("Não foi possível acessar a sessão do Google Drive."));
    request.onsuccess = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.close();
        resolve(null);
        return;
      }
      const transaction = database.transaction(STORE_NAME, "readonly");
      const lookup = transaction.objectStore(STORE_NAME).get("session");
      lookup.onerror = () => reject(lookup.error || new Error("Não foi possível ler a sessão do Google Drive."));
      lookup.onsuccess = () => {
        database.close();
        resolve(lookup.result || null);
      };
    };
  });
}

async function streamDriveFile(request, encodedFileId) {
  let credentials;
  try {
    credentials = await getCredentials();
  } catch {
    return new Response("Não foi possível acessar a sessão do Google Drive.", { status: 500 });
  }
  if (!credentials?.accessToken || credentials.expiresAt <= Date.now()) {
    return new Response("Conecte-se novamente ao Google Drive.", { status: 401 });
  }

  let fileId;
  try {
    fileId = decodeURIComponent(encodedFileId);
  } catch {
    return new Response("ID de arquivo inválido.", { status: 400 });
  }
  const headers = new Headers({ Authorization: `Bearer ${credentials.accessToken}` });
  const range = request.headers.get("Range");
  const ifRange = request.headers.get("If-Range");
  if (range) headers.set("Range", range);
  if (ifRange) headers.set("If-Range", ifRange);

  try {
    return await fetch(`${DRIVE_API}${encodeURIComponent(fileId)}?alt=media`, {
      method: "GET",
      headers,
      cache: "no-store",
      credentials: "omit"
    });
  } catch {
    return new Response("Não foi possível transmitir o vídeo do Google Drive.", { status: 502 });
  }
}
