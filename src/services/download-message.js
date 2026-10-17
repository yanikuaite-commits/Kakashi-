/**
 * Mensagem padronizada de "bot está baixando",
 * usada por todos os comandos de download.
 */
export function downloadingMessage({ fileType = "vídeo" } = {}) {
  return (
    `📥 *KAKASHI BOT• DOWNLOAD*\n\n` +
    `│\n` +
    `│ 📌 *Estado:* Kakashi bot está baixando o seu ${fileType} aguarde uns instantes\n` +
    `│ ©made by Yanik uaite\n` +
    `│\n` +
    `╰──────────────────┘`
  );
}
