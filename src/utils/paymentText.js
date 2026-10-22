/**
 * Leitura dos SMS de pagamento (e-mola e m-pesa).
 *
 * O usuário paga pelo telemóvel e reencaminha o SMS para o bot. Aqui só se
 * extraem os campos; nenhuma decisão de crédito é tomada neste ficheiro, para
 * que o parser fique puro e testável.
 *
 * Formatos suportados (os reais dos dois operadores):
 *
 *   e-mola:  "ID da transacao PP261021.1823.W70113. Transferiste 20.00MT para
 *            conta 879222305, nome: JOEL LAURINDO MANUESSA as 18:23:50 de
 *            21/10/2026. Taxa: 0.00MT. ..."
 *
 *   m-pesa:  "Confirmado DII4LME7OGU. Transferiste 5.00MT e a taxa foi de
 *            1.00MT para 865672009 aos 18/9/26 as 2:37 PM. ..."
 *
 * @author Dev Gui
 */

const PROVIDER_EMOLA = "emola";
const PROVIDER_MPESA = "mpesa";

/** Moçambique é UTC+2 o ano inteiro; o SMS traz sempre a hora local. */
const MOZAMBIQUE_OFFSET = "+02:00";

/**
 * Converte "1,234.50" / "20.00" / "5,00" em número.
 *
 * O separador decimal é o ponto nos SMS reais, mas alguns aparelhos escrevem a
 * vírgula; quando existem os dois, a vírgula é o separador de milhares.
 *
 * @param {string} value
 * @returns {number|null}
 */
function parseAmount(value) {
  if (value == null) return null;

  let texto = String(value).trim().replace(/[^\d.,]/g, "");
  if (!texto) return null;

  if (texto.includes(",") && texto.includes(".")) {
    texto = texto.replace(/,/g, "");
  } else if (texto.includes(",")) {
    texto = texto.replace(",", ".");
  }

  const numero = Number.parseFloat(texto);
  return Number.isFinite(numero) ? numero : null;
}

/**
 * Data/hora do SMS em ISO 8601 (com o offset de Moçambique).
 *
 * Aceita "21/10/2026" (dd/mm/aaaa) e "18/9/26" (d/m/aa) e as horas
 * "18:23:50" e "2:37 PM".
 *
 * @returns {string|null}
 */
function parseDateTime(dateText, timeText, meridiem) {
  const data = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(String(dateText || ""));
  if (!data) return null;

  const dia = Number(data[1]);
  const mes = Number(data[2]);
  let ano = Number(data[3]);
  if (ano < 100) ano += 2000;

  const hora = /(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(timeText || ""));
  if (!hora) return null;

  let h = Number(hora[1]);
  const m = Number(hora[2]);
  const s = Number(hora[3] || 0);
  const pm = /pm/i.test(String(meridiem || ""));

  // "2:37 PM" -> 14:37; "12:05 AM" -> 00:05.
  if (pm && h < 12) h += 12;
  if (!pm && /am/i.test(String(meridiem || "")) && h === 12) h = 0;

  if (mes < 1 || mes > 12 || dia < 1 || dia > 31 || h > 23) return null;

  const pad = (n) => String(n).padStart(2, "0");

  return (
    `${ano}-${pad(mes)}-${pad(dia)}T${pad(h)}:${pad(m)}:${pad(s)}` +
    MOZAMBIQUE_OFFSET
  );
}

/**
 * Identifica o operador pela marca no texto ou pela estrutura do SMS.
 *
 * @param {string} text
 * @returns {"emola"|"mpesa"|null}
 */
function detectProvider(text) {
  if (/m\s*-?\s*pesa/i.test(text)) return PROVIDER_MPESA;
  if (/e\s*-?\s*mola/i.test(text)) return PROVIDER_EMOLA;

  // Sem marca explícita, a estrutura decide: o e-mola abre com "ID da transacao"
  // e o m-pesa com "Confirmado <ID>".
  if (/id\s+da\s+transa[cç]/i.test(text)) return PROVIDER_EMOLA;
  if (/\bconfirmado\b/i.test(text) && /transferiste/i.test(text)) {
    return PROVIDER_MPESA;
  }

  return null;
}

/**
 * Lê um SMS de pagamento.
 *
 * Devolve `null` quando o texto não é um comprovativo reconhecido (sem valor,
 * sem destinatário ou sem operador identificável), para que o bot nunca trate
 * uma mensagem comum como pagamento.
 *
 * @param {string} text
 * @returns {{provider: string, transactionId: string|null, amount: number|null, fee: number|null, destination: string|null, name: string|null, dateTime: string|null} | null}
 */
export function parsePaymentSms(text) {
  const raw = String(text || "").trim();
  if (!raw || !/transferiste/i.test(raw) || !/mt\b/i.test(raw)) return null;

  const provider = detectProvider(raw);
  if (!provider) return null;

  const amountMatch = /transferiste\s+([\d.,]+)\s*mt/i.exec(raw);
  const amount = amountMatch ? parseAmount(amountMatch[1]) : null;
  if (!amount || amount <= 0) return null;

  const feeMatch = /taxa(?:\s+foi\s+de)?\s*:?\s*([\d.,]+)\s*mt/i.exec(raw);
  const fee = feeMatch ? parseAmount(feeMatch[1]) : null;

  const destMatch = /para\s+(?:conta\s+)?(\d{6,})/i.exec(raw);
  const destination = destMatch ? destMatch[1] : null;
  if (!destination) return null;

  const idMatch =
    /id\s+da\s+transa[cç]a?o\s+([A-Za-z0-9.\-]+)/i.exec(raw) ||
    /\bconfirmado\s+([A-Za-z0-9.\-]+)/i.exec(raw);
  // O id termina no ponto da frase ("...W70113. Transferiste").
  const transactionId = idMatch ? idMatch[1].replace(/\.+$/, "") : null;

  // O nome vem entre "nome:" e a hora ("... MANUESSA as 18:23:50") ou a pontuação.
  const nameMatch = /nome\s*:\s*([^.,\n]+)/i.exec(raw);
  const name = nameMatch
    ? nameMatch[1].replace(/\s+as\s+\d{1,2}:\d{2}.*$/i, "").trim().slice(0, 60)
    : null;

  const dateTime =
    parseDateTime(
      /de\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/.exec(raw)?.[1],
      /as\s+(\d{1,2}:\d{2}(?::\d{2})?)/i.exec(raw)?.[1],
      /(\d{1,2}:\d{2}(?::\d{2})?)\s*(am|pm)/i.exec(raw)?.[2],
    ) ||
    parseDateTime(
      /aos\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i.exec(raw)?.[1],
      /as\s+(\d{1,2}:\d{2}(?::\d{2})?)/i.exec(raw)?.[1],
      /(\d{1,2}:\d{2}(?::\d{2})?)\s*(am|pm)/i.exec(raw)?.[2],
    );

  return { provider, transactionId, amount, fee, destination, name, dateTime };
}

/** Etiqueta legível do operador. */
export function providerLabel(provider) {
  if (provider === PROVIDER_EMOLA) return "e-mola";
  if (provider === PROVIDER_MPESA) return "m-pesa";
  return String(provider || "");
}

export { PROVIDER_EMOLA, PROVIDER_MPESA };
