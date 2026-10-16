/**
 * Logs
 *
 * @author Dev Gui
 */
import pkg from "../../package.json" with { type: "json" };

let consoleNoiseFilterInstalled = false;

export function installConsoleNoiseFilter() {
  if (consoleNoiseFilterInstalled) {
    return;
  }

  const originalConsoleInfo = console.info.bind(console);

  console.info = (...args) => {
    if (args[0] === "Closing session:") {
      warningLog(
        "O WhatsApp fechou uma sessão criptografada antiga para renovar as chaves. Isso é um aviso normal da conexão e não indica erro no bot.",
      );
      return;
    }

    if (args[0] === "Removing old closed session:") {
      warningLog(
        "O WhatsApp removeu uma sessão criptografada antiga já fechada. Isso é limpeza normal do histórico de chaves e não indica erro no bot.",
      );
      return;
    }

    originalConsoleInfo(...args);
  };

  consoleNoiseFilterInstalled = true;
}

export function sayLog(message) {
  console.log("\x1b[36m[KAKASHI BOT | TALK]\x1b[0m", message);
}

export function inputLog(message) {
  console.log("\x1b[30m[KAKASHI BOT | INPUT]\x1b[0m", message);
}

export function infoLog(message) {
  console.log("\x1b[34m[KAKASHI BOT | INFO]\x1b[0m", message);
}

export function successLog(message) {
  console.log("\x1b[32m[KAKASHI BOT | SUCCESS]\x1b[0m", message);
}

/**
 * Transforma um erro em uma linha legível.
 *
 * `JSON.stringify(error)` devolve "{}" (message e stack não são enumeráveis),
 * o que deixava o log sem nenhuma informação. Aqui o motivo aparece, com o
 * código HTTP e a causa encadeada de erros como os do axios.
 *
 * @param {unknown} error valor capturado (Error, objeto de rejeição ou string)
 * @returns {string}
 */
export function formatError(error) {
  if (error instanceof Error) {
    const status = error.response?.status;
    const cause =
      error.cause instanceof Error ? ` (causa: ${error.cause.message})` : "";

    return `${error.message}${status ? ` [HTTP ${status}]` : ""}${cause}`;
  }

  if (error && typeof error === "object") {
    try {
      const text = JSON.stringify(error);

      return text && text !== "{}" ? text : String(error);
    } catch {
      return String(error);
    }
  }

  return String(error);
}

export function errorLog(message) {
  console.log(
    "\x1b[31m[KAKASHI BOT | ERROR]\x1b[0m",
    typeof message === "string" ? message : formatError(message),
  );
}

export function warningLog(message) {
  console.log("\x1b[33m[KAKASHI BOT | WARNING]\x1b[0m", message);
}

export function bannerLog() {
  console.log(`\x1b[36m░▀█▀░█▀█░█░█░█▀▀░█▀▀░█░█░▀█▀░░█▀▄░█▀█░▀█▀\x1b[0m`);
  console.log(`░░█░░█▀█░█▀▄░█▀▀░▀▀█░█▀█░░█░░░█▀▄░█░█░░█░`);
  console.log(`\x1b[36m░░▀░░▀░▀░▀░▀░▀▀▀░▀▀▀░▀░▀░▀▀▀░░▀▀░░▀▀▀░░▀░\x1b[0m`);
  console.log(`\x1b[36m🤖 Versão: \x1b[0m${pkg.version}\n`);
}
