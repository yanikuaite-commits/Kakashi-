/**
 * Anúncio das falas do Kakashi no arranque dos downloads.
 *
 * Mesmo padrão do contexto de créditos e do aviso da fila: o dispatcher (e o
 * middleware, para as flows de menu) abre o contexto com o `sendAudioFromFile`
 * do chat, e `downloader.js` usa-o quando começa a baixar. Assim o envio da fala
 * não obriga a passar um helper por todas as camadas de download.
 *
 * Fora de um contexto (testes, chamadas internas) o anúncio é simplesmente
 * ignorado.
 *
 * @author Dev Yanik
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { caminhoDoAudio, encontrarAudio } from "./kakashiAudio.js";

const contexto = new AsyncLocalStorage();

/** Que fala anuncia cada tipo de download. */
export const FALA_DO_DOWNLOAD = {
  video: "video",
  audio: "musica",
};

/** Abre o contexto do anúncio com o `sendAudioFromFile` do chat. */
export function withKakashiVoice(sendAudioFromFile, callback) {
  if (typeof sendAudioFromFile !== "function") return callback();

  return contexto.run({ sendAudioFromFile }, callback);
}

/**
 * Envia a fala que anuncia o arranque de um download.
 *
 * Devolve `true` quando a fala saiu. Um envio falhado nunca sobe: o anúncio é
 * enfeite e não pode impedir o download que ele anuncia.
 */
export async function announceDownload(kind) {
  const nome = FALA_DO_DOWNLOAD[kind];
  if (!nome) return false;

  const { sendAudioFromFile } = contexto.getStore() || {};
  if (typeof sendAudioFromFile !== "function") return false;

  const audio = encontrarAudio(nome);
  if (!audio) return false;

  try {
    await sendAudioFromFile(caminhoDoAudio(audio));
    return true;
  } catch {
    return false;
  }
}
