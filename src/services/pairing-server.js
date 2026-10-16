import http from "node:http";
import { PAIRING_SECRET } from "../config.js";

// Quanto tempo a página espera o bot gerar o código antes de avisar o usuário.
const CODE_TIMEOUT_MS = Number(process.env.PAIRING_CODE_TIMEOUT_MS || 90 * 1000);

// Pedido em andamento: { resolvePhoneNumber, resolveCode }.
// O bot cria com waitForPairingNumber() e o connection.js responde com
// deliverPairingCode() ou failPairingRequest().
let pairingRequest;
let server;

function isAuthorized(request, body) {
  if (!PAIRING_SECRET) {
    return false;
  }

  // O teclado do celular costuma acrescentar espaços: comparamos sem eles.
  const provided = String(
    request.headers["x-pairing-secret"] ?? body?.secret ?? "",
  ).trim();

  return provided === PAIRING_SECRET;
}

function page(message = "") {
  return `<!doctype html>
<html lang="pt-BR">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Kakashi Bot - Pareamento</title>
<style>
body{font-family:system-ui;max-width:480px;margin:48px auto;padding:0 20px;background:#f4f7f9;color:#17212b}
main{background:#fff;padding:24px;border-radius:12px;box-shadow:0 4px 20px #0001}
input,button{box-sizing:border-box;width:100%;padding:12px;margin:8px 0;font-size:16px}
button{background:#176b87;color:#fff;border:0;border-radius:6px}
.msg{white-space:pre-wrap;background:#eef5f7;padding:12px;border-radius:6px}
.hint{font-size:14px;color:#4a5b68}
</style>
<main>
<h1>Kakashi Bot</h1>
<p>Digite o número do WhatsApp com código do país.</p>
<form method="post" action="/api/pairing">
<input name="phone" placeholder="258841234567" inputmode="numeric" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="15" required>
<input name="secret" type="password" placeholder="PAIRING_SECRET" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" required>
<button>Solicitar código</button>
</form>
<p class="hint">O segredo é o valor da constante PAIRING_SECRET (em src/config.js), sem espaços e respeitando maiúsculas e minúsculas.</p>
${message ? `<p class="msg">${message}</p>` : ""}
</main>
</html>`;
}

function send(response, status, body, type = "text/html; charset=utf-8") {
  response.writeHead(status, { "Content-Type": type });
  response.end(body);
}

async function readBody(request) {
  let raw = "";
  for await (const chunk of request) raw += chunk;
  if ((request.headers["content-type"] || "").includes("application/json")) {
    return JSON.parse(raw || "{}");
  }
  return Object.fromEntries(new URLSearchParams(raw));
}

function withTimeout(promise, milliseconds) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), milliseconds);
    timer.unref?.();

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

// Aviso mostrado antes de o usuário digitar, para ele entender de imediato
// quando o pareamento não está disponível.
function statusMessage() {
  if (pairingRequest) {
    return "";
  }

  return "O bot não está aguardando um pareamento agora. Se ele já estiver conectado, não é preciso parear. Se você quer parear outro número, remova a sessão salva (assets/auth/baileys) e reinicie o serviço.";
}

/**
 * Espera o número digitado na página /pairing.
 *
 * @returns {Promise<string>} número informado, apenas dígitos
 */
export function waitForPairingNumber() {
  return new Promise((resolvePhoneNumber) => {
    pairingRequest = { resolvePhoneNumber, resolveCode: undefined };
  });
}

/**
 * Envia para a página o código gerado pelo connection.js.
 *
 * @param {string} code código de pareamento
 * @returns {boolean} true quando havia uma página esperando o código
 */
export function deliverPairingCode(code) {
  if (!pairingRequest?.resolveCode) {
    return false;
  }

  pairingRequest.resolveCode(code);

  return true;
}

/**
 * Avisa a página que o código não pôde ser gerado.
 *
 * @param {string} message motivo exibido para o usuário
 * @returns {boolean} true quando havia uma página esperando o código
 */
export function failPairingRequest(message) {
  if (!pairingRequest?.resolveCode) {
    return false;
  }

  pairingRequest.resolveCode({ error: message });

  return true;
}

export function startPairingServer() {
  if (server) return server;
  const port = Number(process.env.PORT || 3000);
  server = http.createServer(async (request, response) => {
    try {
      if (request.method === "GET" && ["/", "/pairing"].includes(request.url)) {
        return send(response, 200, page(statusMessage()));
      }

      if (request.method !== "POST" || request.url !== "/api/pairing") {
        return send(response, 404, "Not found", "text/plain; charset=utf-8");
      }

      const body = await readBody(request);

      if (!PAIRING_SECRET) {
        return send(
          response,
          503,
          page(
            "O pareamento está desativado: preencha PAIRING_SECRET em src/config.js (ou defina PAIRING_SECRET no ambiente do bot).",
          ),
        );
      }

      if (!isAuthorized(request, body)) {
        return send(
          response,
          401,
          page(
            "Segredo inválido. Use exatamente o valor de PAIRING_SECRET em src/config.js, sem espaços e respeitando maiúsculas e minúsculas.",
          ),
        );
      }

      const phone = String(body.phone || "").replace(/\D/g, "");

      if (phone.length < 10 || phone.length > 15) {
        return send(
          response,
          400,
          page("Número inválido. Use o código do país, sem + ou espaços."),
        );
      }

      const currentRequest = pairingRequest;

      if (!currentRequest) {
        return send(
          response,
          409,
          page(
            "O bot não está aguardando um pareamento agora. Reinicie o serviço para pedir um novo código.",
          ),
        );
      }

      if (currentRequest.resolveCode) {
        return send(
          response,
          409,
          page("Já existe um pedido em andamento. Aguarde o código aparecer nesta página."),
        );
      }

      const codePromise = new Promise((resolveCode) => {
        currentRequest.resolveCode = resolveCode;
      });

      const waiting = withTimeout(codePromise, CODE_TIMEOUT_MS);

      // Só agora o bot recebe o número: quando ele gerar o código, o
      // connection.js chama deliverPairingCode() e esta página é respondida.
      currentRequest.resolvePhoneNumber(phone);

      let result;

      try {
        result = await waiting;
      } catch (error) {
        result = { error: "O bot demorou para gerar o código. Tente novamente." };
      }

      pairingRequest = undefined;

      if (typeof result === "string" && result) {
        return send(response, 200, page(`Código de pareamento: ${result}`));
      }

      if (result?.error) {
        return send(response, 500, page(result.error));
      }

      return send(response, 500, page("Não foi possível gerar o código."));
    } catch (error) {
      console.error("Servidor de pareamento:", error.message);
      return send(response, 500, page("Erro interno ao solicitar o código."));
    }
  });
  server.listen(port, "0.0.0.0", () =>
    console.log(`Pareamento web disponível na porta ${port}`),
  );
  return server;
}
