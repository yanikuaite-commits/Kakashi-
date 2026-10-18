/**
 * Utilize este arquivo para definir as mensagens de boas-vindas e despedidas do grupo.
 * As mensagens podem conter a menção ao membro que entrou ou saiu do grupo.
 * Você pode personalizar as mensagens conforme necessário.
 *
 * Para colocar a menção ao membro, use "@member" na mensagem.
 *
 * @author Dev Gui
 */
export const welcomeMessage =
  "👋 Bem-vindo(a) @member ao *{grupo}*!\n📜 Lê as regras com {prefixo}regras";
export const exitMessage = "👋 @member saiu do grupo. Até à próxima!";

export function clearChat() {
  return `🗑️${"\n".repeat(1891)}🗑️`;
}
