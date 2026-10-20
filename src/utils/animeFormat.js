/**
 * Helpers puros do fluxo de animes (providers via @consumet/extensions).
 *
 * Ficam separados do cliente HTTP (`src/services/anime.js`) para poderem ser
 * testados sem rede e sem Baileys: aqui só há transformação de dados.
 *
 * Sobre os `rowId`: o WhatsApp limita o tamanho do `rowId` e os links de
 * stream dos providers são longos e assinados (m3u8 com token), então guardar a
 * URL dentro do `rowId` faria a linha ser descartada. Por isso as linhas usam
 * índices estáveis (`anm:ep:<i>` / `anm:src:<i>`) e o array real vive na
 * sessão (ver `src/utils/animeMenu.js`).
 *
 * @author Dev Gui
 */

/** Quantos episódios aparecem na primeira lista (pedido: os 10 primeiros). */
export const EPISODES_PER_PAGE = 10;

/** Prefixos de token do menu de animes. */
export const ANIME_TOKEN_PREFIXES = ["anm:ep:", "anm:src:"];

/**
 * Rótulo legível de um provider de animes ("animeunity" → "AnimeUnity").
 *
 * @param {string} provider
 * @returns {string}
 */
export function animeProviderLabel(provider) {
  const nome = String(provider || "").trim();
  if (!nome) return "Animes";
  return nome.charAt(0).toUpperCase() + nome.slice(1);
}

/**
 * Chave da sessão por chat + autor.
 *
 * @param {string} chatId
 * @param {string} ownerId
 * @returns {string}
 */
export function animeSessionKey(chatId, ownerId) {
  return `${chatId}:${ownerId}`;
}

/**
 * Deriva um rótulo de qualidade legível ("1080p", "720p", "auto").
 *
 * @param {{quality?: string, resolution?: string, height?: number}} [source]
 * @returns {string}
 */
export function animeQualityLabel(source = {}) {
  const bruto = String(source.quality || source.resolution || "").toLowerCase();

  const porAltura = bruto.match(/(\d{3,4})\s*p?/);
  if (porAltura) return `${porAltura[1]}p`;

  const alturaDireta = Number(source.height);
  if (Number.isFinite(alturaDireta) && alturaDireta > 0) {
    return `${alturaDireta}p`;
  }

  return bruto || "auto";
}

/**
 * Monta as linhas da lista de episódios (os 10 primeiros).
 *
 * @param {Array<{id: string, number?: number, title?: string}>} episodes
 * @returns {Array<{id: string, title: string, description: string, episodeId: string}>}
 */
export function buildEpisodeRows(episodes = []) {
  return episodes.slice(0, EPISODES_PER_PAGE).map((episode, index) => {
    const numero = episode?.number ?? index + 1;
    const titulo = String(episode?.title || "").trim();
    const jaTemNumero = new RegExp(`epis[oó]dio\\s*${numero}`, "i").test(titulo);

    return {
      id: `anm:ep:${index}`,
      title: `Episódio ${numero}`.slice(0, 60),
      description: (jaTemNumero ? titulo || "Ver episódio" : titulo || "Ver episódio").slice(
        0,
        72,
      ),
      episodeId: String(episode?.id || ""),
    };
  });
}

/**
 * Normaliza e ordena as fontes de vídeo por qualidade (maior primeiro).
 *
 * @param {Array<{url?: string, quality?: string, resolution?: string, isM3U8?: boolean}>} sources
 * @returns {Array<{url: string, label: string, isM3U8: boolean}>}
 */
export function normalizeSources(sources = []) {
  const validas = (Array.isArray(sources) ? sources : [])
    .filter((source) => source?.url)
    .map((source) => ({
      url: String(source.url),
      label: animeQualityLabel(source),
      isM3U8: Boolean(source.isM3U8),
    }));

  return validas.sort((a, b) => {
    const altura = (rotulo) => Number(String(rotulo).replace(/\D/g, "")) || 0;
    return altura(b.label) - altura(a.label);
  });
}

/**
 * Monta as linhas da lista de qualidades a partir das fontes.
 *
 * @param {Array<{url: string, label: string, isM3U8: boolean}>} sources
 * @returns {Array<{id: string, title: string, description: string, url: string}>}
 */
export function buildQualityRows(sources = []) {
  return sources.map((source, index) => ({
    id: `anm:src:${index}`,
    title: `📺 ${source.label}`,
    description: source.isM3U8 ? "Stream HLS" : "Ficheiro direto",
    url: source.url,
  }));
}

/**
 * Lê o índice de um token de anime (`anm:ep:3` → 3).
 *
 * @param {string} token
 * @param {string} [prefixo]
 * @returns {number} índice ou -1
 */
export function animeTokenIndex(token, prefixo = "anm:") {
  const texto = String(token || "");
  if (!texto.startsWith(prefixo)) return -1;

  const valor = Number(texto.slice(prefixo.length));
  return Number.isInteger(valor) && valor >= 0 ? valor : -1;
}

/**
 * Só os dígitos de um JID — a parte estável da identidade.
 *
 * Remove primeiro o servidor (`@lid`, `@s.whatsapp.net`) e o sufixo de
 * aparelho (`:12`), senão `244...:12@lid` e `244...@lid` dariam dígitos
 * diferentes e a MESMA pessoa não seria reconhecida.
 *
 * @param {string} jid
 * @returns {string}
 */
export function jidDigits(jid) {
  const texto = String(jid || "");
  if (!texto) return "";

  return texto.split("@")[0].split(":")[0].replace(/\D/g, "");
}

/**
 * Identidades comparáveis de um ou mais JIDs (participant + participantAlt).
 *
 * @param {...(string|undefined)} jids
 * @returns {Set<string>}
 */
export function jidIdentities(...jids) {
  const identidades = new Set();

  for (const jid of jids) {
    const digitos = jidDigits(jid);
    if (digitos) identidades.add(digitos);
  }

  return identidades;
}

/**
 * true se dois conjuntos de identidades partilham algum valor.
 *
 * @param {Set<string>|Array<string>} a
 * @param {Set<string>|Array<string>} b
 * @returns {boolean}
 */
export function identitiesOverlap(a, b) {
  if (!a || !b) return false;

  const menor = a.size <= b.size ? a : b;
  const maior = menor === a ? b : a;

  for (const valor of menor) {
    if (maior.has(valor)) return true;
  }

  return false;
}
