import http from "node:http";
import { PAIRING_SECRET } from "../config.js";

let resolvePhoneNumber;
let server;

function isAuthorized(request, body) {
  const secret = PAIRING_SECRET;
  return Boolean(secret) && (request.headers["x-pairing-secret"] === secret || body.secret === secret);
}

function page(message = "") {
  return `<!doctype html><html lang="pt-BR"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kakashi Bot - Pareamento</title><style>body{font-family:system-ui;max-width:480px;margin:48px auto;padding:0 20px;background:#f4f7f9;color:#17212b}main{background:#fff;padding:24px;border-radius:12px;box-shadow:0 4px 20px #0001}input,button{box-sizing:border-box;width:100%;padding:12px;margin:8px 0;font-size:16px}button{background:#176b87;color:#fff;border:0;border-radius:6px}.msg{white-space:pre-wrap;background:#eef5f7;padding:12px;border-radius:6px}</style><main><h1>Kakashi Bot</h1><p>Digite o número do WhatsApp com código do país.</p><form method="post" action="/api/pairing"><input name="phone" placeholder="258841234567" required><input name="secret" type="password" placeholder="PAIRING_SECRET" required><button>Solicitar código</button></form>${message ? `<p class="msg">${message}</p>` : ""}</main></html>`;
}

function send(response, status, body, type = "text/html; charset=utf-8") {
  response.writeHead(status, { "Content-Type": type });
  response.end(body);
}

async function readBody(request) {
  let raw = "";
  for await (const chunk of request) raw += chunk;
  if ((request.headers["content-type"] || "").includes("application/json")) return JSON.parse(raw || "{}");
  return Object.fromEntries(new URLSearchParams(raw));
}

export function waitForPairingNumber() {
  return new Promise((resolve) => { resolvePhoneNumber = resolve; });
}

export function startPairingServer() {
  if (server) return server;
  const port = Number(process.env.PORT || 3000);
  server = http.createServer(async (request, response) => {
    try {
      if (request.method === "GET" && ["/", "/pairing"].includes(request.url)) return send(response, 200, page());
      if (request.method !== "POST" || request.url !== "/api/pairing") return send(response, 404, "Not found", "text/plain; charset=utf-8");
      const body = await readBody(request);
      if (!isAuthorized(request, body)) return send(response, 401, page("Segredo inválido ou não configurado."));
      const phone = String(body.phone || "").replace(/\D/g, "");
      if (phone.length < 10 || phone.length > 15) return send(response, 400, page("Número inválido. Use o código do país, sem + ou espaços."));
      if (!resolvePhoneNumber) return send(response, 409, page("O bot já está pareado ou ainda não está pronto para novo pareamento."));
      const resolve = resolvePhoneNumber;
      resolvePhoneNumber = undefined;
      const code = await resolve(phone);
      return send(response, code ? 200 : 500, page(code ? `Código de pareamento: ${code}` : "Não foi possível gerar o código."));
    } catch (error) {
      console.error("Servidor de pareamento:", error.message);
      return send(response, 500, page("Erro interno ao solicitar o código."));
    }
  });
  server.listen(port, "0.0.0.0", () => console.log(`Pareamento web disponível na porta ${port}`));
  return server;
}