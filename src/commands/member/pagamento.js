import {
  OWNER_CONTACT,
  PAYMENT_E_MOLA_NAME,
  PAYMENT_E_MOLA_NUMBER,
  PAYMENT_M_PESA_NAME,
  PAYMENT_M_PESA_NUMBER,
  PREFIX,
} from "../../config.js";
import { formatMessage } from "../../utils/formatMessage.js";

/**
 * Monta o painel com os números que recebem o pagamento.
 *
 * Cada número vem seguido do respetivo titular, para o usuário saber a quem
 * está a transferir antes de enviar o dinheiro. O rodapé explica o passo
 * seguinte, que é reencaminhar o SMS do comprovativo para o bot — sem isso o
 * pagamento não é detetado.
 *
 * @returns {string}
 */
export function paymentMessage() {
  const contact = String(OWNER_CONTACT || "").replace(/\D/g, "");

  return formatMessage({
    icone: "💳",
    titulo: "Pagamento",
    campos: [
      "Faz a transferência para um destes números:",
      "",
      `📱 *e-mola:* ${PAYMENT_E_MOLA_NUMBER}`,
      `👤 ${PAYMENT_E_MOLA_NAME}`,
      "",
      `📱 *m-pesa:* ${PAYMENT_M_PESA_NUMBER}`,
      `👤 ${PAYMENT_M_PESA_NAME}`,
      "",
      "📸 Depois de pagar, *reencaminha o SMS do comprovativo* para este chat.",
      "O dono confirma o pagamento e os créditos entram na tua conta.",
      "",
      `📊 Confere os pacotes com *${PREFIX}tabela-creditos*`,
      contact ? `💬 Dúvidas? Fala com o dono: https://wa.me/${contact}` : null,
    ].filter((linha) => linha !== null),
  });
}

export default {
  name: "pagamento",
  description: "Mostra os números de transferência (e-mola e m-pesa) para recarregar créditos",
  // "recarregar"/"recarga" NÃO entram aqui: são do comando de dono
  // (src/commands/owner/recarregar.js) e o comando de membro sombrearia o dele.
  commands: ["pagamento", "pagamentos", "pagar", "como-pagar"],
  usage: `${PREFIX}pagamento`,
  /**
   * @param {CommandHandleProps} props
   */
  handle: async ({ sendReply, sendReact }) => {
    await sendReact("💳");

    await sendReply(paymentMessage());
  },
};
