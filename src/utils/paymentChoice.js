/**
 * Escolha do utilizador numa compra ambígua (créditos avulsos ou assinatura).
 *
 * O valor de 20 MT existe nas duas tabelas: dá 65 créditos avulsos ou 7 dias de
 * assinatura. Quando o SMS desse valor chega, o bot pergunta "1" ou "2" e a
 * resposta é guardada no PRÓPRIO pedido pendente (`setRechargeKind`), não aqui.
 *
 * Guardar no pedido — e não neste mapa — é o que faz a escolha sobreviver: o
 * dono confirma mais tarde, possivelmente noutra hora, e `confirmRecharge` lê o
 * `kind` do registo. Este mapa só existe para saber que a próxima mensagem
 * curta do utilizador é a resposta a esta pergunta.
 *
 * @author Dev Gui
 */
import { errorLog, infoLog } from "./logger.js";
import { setRechargeKind } from "../services/recharges.js";

/**
 * Quanto tempo a pergunta fica à espera de resposta. Curto de propósito: um "1"
 * respondido horas depois seria um comando perdido, não uma escolha.
 */
export const PAYMENT_CHOICE_TTL_MS = 30 * 60 * 1000;

const escolhasPendentes = new Map();

function chave(chatId, senderLid) {
  return `${chatId}:${senderLid}`;
}

function limpar(chaveAlvo) {
  const pendente = escolhasPendentes.get(chaveAlvo);

  if (pendente?.timer) clearTimeout(pendente.timer);

  escolhasPendentes.delete(chaveAlvo);
}

/**
 * Regista que o utilizador tem uma pergunta de escolha à espera de resposta.
 *
 * @param {{chatId: string, senderLid: string, rechargeKey: string, sendReply?: Function}} dados
 * @returns {boolean}
 */
export function registerPaymentChoice({ chatId, senderLid, rechargeKey }) {
  if (!chatId || !senderLid || !rechargeKey) return false;

  const alvo = chave(chatId, senderLid);
  limpar(alvo);

  const pendente = { chatId, senderLid, rechargeKey, timer: null };

  pendente.timer = setTimeout(() => {
    // Sem resposta, o pedido fica como está (créditos) e o dono decide na
    // confirmação. Não vale a pena avisar: a mensagem original já o diz.
    limpar(alvo);
  }, PAYMENT_CHOICE_TTL_MS);
  pendente.timer.unref?.();

  escolhasPendentes.set(alvo, pendente);

  return true;
}

/** Introspeção usada nos testes. */
export function getPaymentChoice(chatId, senderLid) {
  return escolhasPendentes.get(chave(chatId, senderLid)) || null;
}

/** Limpa todas as escolhas (usado nos testes). */
export function resetPaymentChoices() {
  for (const alvo of [...escolhasPendentes.keys()]) limpar(alvo);
}

/**
 * Trata a resposta "1"/"2" de uma compra ambígua.
 *
 * Só o autor do pagamento converte (o mapa é indexado por ele): o "1" de outro
 * membro do grupo segue o fluxo normal, em silêncio, em vez de mexer na compra
 * de quem pagou.
 *
 * @param {{chatId: string, senderLid: string, text: string, sendReply?: Function}} dados
 * @returns {Promise<boolean>} true se a mensagem foi tratada aqui
 */
export async function handlePaymentChoiceReply({
  chatId,
  senderLid,
  text,
  sendReply,
}) {
  const valor = String(text || "").trim();

  if (valor !== "1" && valor !== "2") return false;

  const alvo = chave(chatId, senderLid);
  const pendente = escolhasPendentes.get(alvo);

  if (!pendente) return false;

  const tipo = valor === "2" ? "assinatura" : "creditos";

  try {
    const resultado = setRechargeKind(pendente.rechargeKey, tipo);

    if (!resultado.ok) {
      limpar(alvo);
      await sendReply?.(
        "⏳ Esse pagamento já não está à espera de confirmação. Envia o SMS novamente se precisares.",
      ).catch?.(() => {});
      return true;
    }

    infoLog(
      `[pagamento] ${senderLid} escolheu "${tipo}" para ${pendente.rechargeKey}`,
    );

    await sendReply?.(
      tipo === "assinatura"
        ? "⭐ *Assinatura escolhida!* O dono vai confirmar e o bónus entra todos os dias até o plano acabar."
        : "🎁 *Créditos escolhidos!* O dono vai confirmar e os créditos entram na tua conta.",
    ).catch?.(() => {});
  } catch (error) {
    errorLog(`[pagamento] falha ao guardar a escolha: ${error.message}`);
  } finally {
    limpar(alvo);
  }

  return true;
}
