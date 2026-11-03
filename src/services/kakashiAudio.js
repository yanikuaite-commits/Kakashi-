/**
 * Catálogo das falas do Kakashi.
 *
 * Só dados: cada fala sabe o seu ficheiro, os nomes pelos quais responde e a
 * transcrição. O envio fica em `src/commands/member/funny/kakashi.js`.
 *
 * Os ficheiros vivem em `assets/audios/`. A transcrição serve para o comando
 * listar as falas e para quem editar este ficheiro saber o que cada uma diz.
 *
 * @author Dev Yanik
 */
import path from "node:path";
import { ASSETS_DIR } from "../config.js";

export const KAKASHI_AUDIOS_DIR = path.join(ASSETS_DIR, "audios");

export const KAKASHI_AUDIOS = [
  {
    id: "chidori",
    arquivo: "kakashi-chidori.mp3",
    nomes: ["chidori"],
    descricao: "Aviso depois de vencer alguém.",
    transcricao:
      "Acabei de varrer esse otário com o Chidori, já fica o aviso para os outros participantes.",
  },
  {
    id: "pedido",
    arquivo: "kakashi-realizando-pedido.mp3",
    nomes: ["pedido"],
    descricao: "Resposta a quem apressa um pedido.",
    transcricao:
      "Olha, não enche meu saco, já estou realizando o teu pedido.",
  },
  {
    id: "video",
    arquivo: "kakashi-baixar-video.mp3",
    nomes: ["video", "vídeo"],
    descricao: "Anúncio antes de baixar um vídeo.",
    transcricao:
      "Vou baixar o seu vídeo com tanta qualidade que nem o meu Jutsu.",
  },
  {
    id: "musica",
    arquivo: "kakashi-baixar-musica.mp3",
    nomes: ["musica", "música"],
    descricao: "Anúncio antes de baixar uma música.",
    transcricao:
      "Vou baixar a sua música com tanta qualidade que nem o meu Jutsu.",
  },
];

/** Caminho absoluto do ficheiro de uma fala. */
export function caminhoDoAudio(audio) {
  return path.join(KAKASHI_AUDIOS_DIR, audio.arquivo);
}

/** Normaliza um nome para comparação (minúsculas, sem acentos). */
function normalizar(valor) {
  return String(valor || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Procura uma fala pelo id ou por qualquer um dos seus nomes.
 * Devolve `null` quando não há correspondência.
 */
export function encontrarAudio(nome) {
  const alvo = normalizar(nome);
  if (!alvo) return null;

  return (
    KAKASHI_AUDIOS.find(
      (audio) =>
        normalizar(audio.id) === alvo ||
        audio.nomes.some((n) => normalizar(n) === alvo),
    ) || null
  );
}
