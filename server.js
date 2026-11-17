const http = require("node:http");
const nodeFs = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { Readable } = require("node:stream");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const CATALOG_FILE = path.join(DATA_DIR, "catalog.json");
const envFile = path.join(ROOT, ".env");
if (nodeFs.existsSync(envFile)) {
  for (const line of nodeFs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && !Object.prototype.hasOwnProperty.call(process.env, match[1])) {
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
    }
  }
}
const PORT = Number(process.env.PORT || 4173);
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const sessions = new Map();
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json"
};

async function ensureCatalog() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(CATALOG_FILE);
  } catch {
    await fs.writeFile(CATALOG_FILE, "[]\n", "utf8");
  }
}

async function readCatalog() {
  return JSON.parse(await fs.readFile(CATALOG_FILE, "utf8"));
}

async function writeCatalog(catalog) {
  const temporaryFile = `${CATALOG_FILE}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporaryFile, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
  await fs.rename(temporaryFile, CATALOG_FILE);
}

function sendJson(response, status, value, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers
  });
  response.end(JSON.stringify(value));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("A solicitação excede o limite de 1 MB."));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(new Error("O corpo da solicitação não contém JSON válido."));
      }
    });
    request.on("error", reject);
  });
}

function getSession(request) {
  const cookie = request.headers.cookie || "";
  const match = cookie.match(/(?:^|;\s*)neon_session=([a-f0-9-]+)/);
  if (!match) return null;
  const session = sessions.get(match[1]);
  if (!session || session.expiresAt <= Date.now()) {
    sessions.delete(match[1]);
    return null;
  }
  return session;
}

function cookieOptions(request) {
  const secure = request.socket.encrypted || request.headers["x-forwarded-proto"] === "https";
  return `Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

async function driveRequest(session, url, headers = {}) {
  return fetch(url, {
    headers: { Authorization: `Bearer ${session.accessToken}`, ...headers }
  });
}

async function driveApi(response, session, url, headers) {
  const upstream = await driveRequest(session, url, headers);
  const body = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    const message = body.error && body.error.message
      ? body.error.message
      : `O Google Drive respondeu com status ${upstream.status}.`;
    sendJson(response, upstream.status, { error: message });
    return null;
  }
  return body;
}

function validFolderId(folderId) {
  return typeof folderId === "string" && folderId.length > 0 && folderId.length < 256;
}

async function handleApi(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/config") {
    sendJson(response, 200, { clientId: CLIENT_ID });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/session") {
    const session = getSession(request);
    if (!session) {
      sendJson(response, 200, { connected: false });
      return true;
    }
    sendJson(response, 200, { connected: true, email: session.email, expiresAt: session.expiresAt });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/session") {
    const body = await readBody(request);
    if (typeof body.accessToken !== "string" || body.accessToken.length < 20) {
      sendJson(response, 400, { error: "Token de acesso do Google inválido." });
      return true;
    }
    const tokenInfoResponse = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(body.accessToken)}`
    );
    const tokenInfo = await tokenInfoResponse.json().catch(() => ({}));
    if (!tokenInfoResponse.ok || !String(tokenInfo.scope || "").includes("drive.readonly")) {
      sendJson(response, 401, { error: "O acesso de leitura ao Google Drive não foi autorizado." });
      return true;
    }
    const sessionId = crypto.randomUUID();
    const expiresIn = Math.max(1, Number(tokenInfo.expires_in) || 3600);
    sessions.set(sessionId, {
      accessToken: body.accessToken,
      email: tokenInfo.email || "",
      expiresAt: Date.now() + expiresIn * 1000
    });
    sendJson(response, 200, { email: tokenInfo.email || "" }, {
      "Set-Cookie": `neon_session=${sessionId}; ${cookieOptions(request)}`
    });
    return true;
  }

  if (request.method === "DELETE" && url.pathname === "/api/session") {
    const cookie = request.headers.cookie || "";
    const match = cookie.match(/(?:^|;\s*)neon_session=([a-f0-9-]+)/);
    if (match) sessions.delete(match[1]);
    sendJson(response, 200, { ok: true }, {
      "Set-Cookie": `neon_session=; Max-Age=0; ${cookieOptions(request)}`
    });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/works") {
    sendJson(response, 200, await readCatalog());
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/works") {
    const session = getSession(request);
    if (!session) {
      sendJson(response, 401, { error: "Conecte o Google Drive para cadastrar uma obra." });
      return true;
    }
    const body = await readBody(request);
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const folderId = typeof body.folderId === "string" ? body.folderId.trim() : "";
    if (!title || title.length > 120 || !validFolderId(folderId)) {
      sendJson(response, 400, { error: "Informe um título e um ID de pasta do Drive válidos." });
      return true;
    }
    const folderResponse = await driveRequest(
      session,
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?fields=id,mimeType`
    );
    const folder = await folderResponse.json().catch(() => ({}));
    if (!folderResponse.ok || folder.mimeType !== "application/vnd.google-apps.folder") {
      sendJson(response, 400, {
        error: folder.error && folder.error.message
          ? folder.error.message
          : "Não foi possível acessar essa pasta. Verifique o link e o compartilhamento no Drive."
      });
      return true;
    }
    const catalog = await readCatalog();
    const work = {
      id: crypto.randomUUID(),
      title,
      synopsis: typeof body.synopsis === "string" ? body.synopsis.trim().slice(0, 1000) : "",
      cover: typeof body.cover === "string" ? body.cover.trim().slice(0, 2048) : "",
      folderId,
      openingSkipSeconds: Math.min(900, Math.max(0, Number(body.openingSkipSeconds) || 0)),
      createdAt: new Date().toISOString()
    };
    catalog.unshift(work);
    await writeCatalog(catalog);
    sendJson(response, 201, work);
    return true;
  }

  const updateWorkMatch = url.pathname.match(/^\/api\/works\/([a-f0-9-]+)$/);
  if (request.method === "PUT" && updateWorkMatch) {
    const session = getSession(request);
    if (!session) {
      sendJson(response, 401, { error: "Conecte o Google Drive para editar uma obra." });
      return true;
    }
    const catalog = await readCatalog();
    const work = catalog.find((item) => item.id === updateWorkMatch[1]);
    if (!work) {
      sendJson(response, 404, { error: "Obra não encontrada." });
      return true;
    }
    const body = await readBody(request);
    if (typeof body.title === "string" && body.title.trim()) {
      work.title = body.title.trim().slice(0, 120);
    }
    if (typeof body.synopsis === "string") work.synopsis = body.synopsis.trim().slice(0, 1000);
    if (typeof body.cover === "string") work.cover = body.cover.trim().slice(0, 2048);
    if (body.openingSkipSeconds !== undefined) {
      work.openingSkipSeconds = Math.min(900, Math.max(0, Number(body.openingSkipSeconds) || 0));
    }
    await writeCatalog(catalog);
    sendJson(response, 200, work);
    return true;
  }

  const deleteWorkMatch = url.pathname.match(/^\/api\/works\/([a-f0-9-]+)$/);
  if (request.method === "DELETE" && deleteWorkMatch) {
    if (!getSession(request)) {
      sendJson(response, 401, { error: "Conecte o Google Drive para remover uma obra." });
      return true;
    }
    const catalog = await readCatalog();
    const updatedCatalog = catalog.filter((item) => item.id !== deleteWorkMatch[1]);
    if (updatedCatalog.length === catalog.length) {
      sendJson(response, 404, { error: "Obra não encontrada." });
      return true;
    }
    await writeCatalog(updatedCatalog);
    sendJson(response, 200, { ok: true });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/drive/files") {
    const session = getSession(request);
    if (!session) {
      sendJson(response, 401, { error: "Sua sessão do Google Drive expirou. Conecte-se novamente." });
      return true;
    }
    const folderId = url.searchParams.get("folderId") || "";
    if (!validFolderId(folderId)) {
      sendJson(response, 400, { error: "ID da pasta do Drive inválido." });
      return true;
    }
    const query = `'${folderId.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}' in parents and trashed = false`;
    const driveUrl = new URL("https://www.googleapis.com/drive/v3/files");
    driveUrl.searchParams.set("q", query);
    driveUrl.searchParams.set("fields", "files(id,name,mimeType,size,modifiedTime)");
    driveUrl.searchParams.set("pageSize", "1000");
    const result = await driveApi(response, session, driveUrl);
    if (!result) return true;
    const episodes = (result.files || [])
      .filter((file) => file.mimeType.startsWith("video/") && /\.mp4$/i.test(file.name))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }))
      .map((file, index) => ({ ...file, episodeNumber: index + 1 }));
    sendJson(response, 200, episodes);
    return true;
  }

  const streamMatch = url.pathname.match(/^\/api\/drive\/files\/([^/]+)\/content$/);
  if (request.method === "GET" && streamMatch) {
    const session = getSession(request);
    if (!session) {
      sendJson(response, 401, { error: "Sua sessão do Google Drive expirou. Conecte-se novamente." });
      return true;
    }
    const fileId = decodeURIComponent(streamMatch[1]);
    const headers = {};
    if (request.headers.range) headers.Range = request.headers.range;
    if (request.headers["if-range"]) headers["If-Range"] = request.headers["if-range"];
    const upstream = await driveRequest(
      session,
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
      headers
    );
    response.writeHead(upstream.status, {
      "Content-Type": upstream.headers.get("content-type") || "video/mp4",
      "Accept-Ranges": upstream.headers.get("accept-ranges") || "bytes",
      ...(upstream.headers.get("content-length")
        ? { "Content-Length": upstream.headers.get("content-length") }
        : {}),
      ...(upstream.headers.get("content-range")
        ? { "Content-Range": upstream.headers.get("content-range") }
        : {}),
      "Cache-Control": "private, no-store"
    });
    if (upstream.body) {
      Readable.fromWeb(upstream.body).pipe(response);
    } else {
      response.end();
    }
    return true;
  }

  return false;
}

async function serveStatic(request, response, url) {
  const requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.resolve(PUBLIC_DIR, `.${requestedPath}`);
  if (!filePath.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
    sendJson(response, 403, { error: "Acesso negado." });
    return;
  }
  try {
    const content = await fs.readFile(filePath);
    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-cache"
    });
    response.end(content);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "EISDIR") {
      sendJson(response, 404, { error: "Página não encontrada." });
      return;
    }
    throw error;
  }
}

async function handleRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      const handled = await handleApi(request, response, url);
      if (!handled) sendJson(response, 404, { error: "Endpoint não encontrado." });
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      sendJson(response, 405, { error: "Método não permitido." });
      return;
    }
    await serveStatic(request, response, url);
  } catch (error) {
    console.error(error);
    if (!response.headersSent) sendJson(response, 500, { error: error.message || "Erro interno do servidor." });
    else response.destroy(error);
  }
}

async function start() {
  await ensureCatalog();
  const server = http.createServer(handleRequest);
  server.listen(PORT, () => {
    console.log(`NEON STREAMING disponível em http://localhost:${PORT}`);
    if (!CLIENT_ID) console.warn("Configure GOOGLE_CLIENT_ID para habilitar a conexão com o Google Drive.");
  });
}

start().catch((error) => {
  console.error("Não foi possível iniciar o servidor:", error);
  process.exitCode = 1;
});
