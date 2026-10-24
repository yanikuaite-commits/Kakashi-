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

/** Quantos episódios aparecem por página da lista. */
export const EPISODES_PER_PAGE = 10;

/** Faixas de áudio que os providers podem publicar. */
export const AUDIO_SUBBED = "subbed";
export const AUDIO_DUBBED = "dubbed";
export const AUDIO_VERSIONS = [AUDIO_SUBBED, AUDIO_DUBBED];

/** Prefixos de token do menu de animes. */
export const ANIME_TOKEN_PREFIXES = [
  "anm:sea:",
  "anm:ep:",
  "anm:aud:",
  "anm:src:",
  "anm:pg:",
];

/**
 * Título utilizável numa pesquisa, sem os sufixos que só um site usa.
 *
 * O AnimeGG devolve títulos como "Jujutsu Kaisen (TV)" e o AniTube como
 * "Naruto Shippuden (Dublado)". Esses sufixos são metadados daquele site e não
 * fazem parte do nome: pesquisá-los literalmente nos OUTROS providers (o
 * fallback de episódio faz isso) devolve 0 resultados e o episódio acaba sempre
 * no último da lista (o anikoto), mesmo quando os anteriores o tinham.
 *
 * "Jujutsu Kaisen (TV)" passa assim a ser encontrado no AnimeHeaven e no
 * AnimesOnlineHD, e "One Piece" deixa de trazer "One Piece: Episode of Merry"
 * por o título original ter qualificado a pesquisa.
 *
 * Puro (sem rede) para poder ser testado.
 *
 * @param {string} titulo
 * @returns {string}
 */
export function tituloDeBusca(titulo) {
  return String(titulo || "")
    .replace(/\s*[([{]\s*(?:tv|dub|dublado|legendado|sub|subbed|ova|ona|filme|movie)\s*[)\]}]/gi, " ")
    .replace(/\s+[-–—]\s*(?:dublado|legendado)\s*$/i, "")
    .replace(/\s+(?:dublado|legendado)\s*$/i, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s*[-–—:]\s*$/, "")
    .trim();
}

/**
 * Escolhe o resultado que corresponde melhor ao termo pesquisado.
 *
 * O primeiro resultado de um provider não é necessariamente o título pedido: no
 * AnimeGG, pesquisar "One Piece" devolve primeiro "One Piece: Episode of Merry",
 * um especial de 1 episódio, e não a série. A correspondência EXATA (sem os
 * sufixos de site) resolve isso e não muda nada quando o primeiro resultado já
 * é o exato.
 *
 * Puro (sem rede) para poder ser testado.
 *
 * @param {Array<{title?: string}>} resultados
 * @param {string} termo
 * @returns {object|null}
 */
export function melhorResultado(resultados = [], termo = "") {
  const lista = Array.isArray(resultados) ? resultados : [];
  if (!lista.length) return null;

  const alvo = tituloDeBusca(termo).toLowerCase();
  if (!alvo) return lista[0];

  return (
    lista.find((r) => tituloDeBusca(r?.title).toLowerCase() === alvo) || lista[0]
  );
}

/**
 * Escolhe, entre os episódios candidatos, o que serve o número pedido.
 *
 * Três regras, por ordem:
 *
 * 1. a faixa pedida explicitamente (o utilizador tocou em "Dublado") é
 *    REQUERIDA: um episódio sem ela não serve, porque servir outra faixa é o
 *    defeito que este fluxo existe para corrigir;
 * 2. sem escolha explícita, prefere-se o DUBLADO (`preferirDublado`): é o que a
 *    maioria dos pedidos procura, e o site que o publica é o que interessa;
 * 3. sem dublado, cai para o primeiro candidato (o legendado), para o episódio
 *    não desaparecer só por não ter dublagem.
 *
 * Puro (sem rede) para poder ser testado.
 *
 * @param {Array<{versions?: string[]}>} candidatos
 * @param {string} [audioVersion] faixa pedida, "" quando não houve escolha
 * @param {boolean} [preferirDublado]
 * @returns {object|null}
 */
export function escolherEpisodio(candidatos = [], audioVersion = "", preferirDublado = true) {
  const lista = Array.isArray(candidatos) ? candidatos : [];
  const faixa = String(audioVersion || "").trim().toLowerCase();

  if (faixa) {
    return lista.find((ep) => (ep?.versions || []).includes(faixa)) || null;
  }

  if (preferirDublado) {
    const dublado = lista.find((ep) => (ep?.versions || []).includes(AUDIO_DUBBED));
    if (dublado) return dublado;
  }

  return lista[0] || null;
}

/**
 * true se a faixa "dublada" deste provider é em PORTUGUÊS.
 *
 * A faixa é um booleano no site ("dubbed" ou não), mas o IDIOMA dessa dublagem
 * é uma propriedade do SITE, não da faixa: o animesonlinehd e o anitube são
 * brasileiros (dublagem PT-BR), o animegg é inglês (dublagem inglesa). Sem esta
 * distinção, "Dublado" podia entregar áudio inglês com rótulo português.
 *
 * @param {string} provider
 * @param {string[]} [listaPt] providers PT-BR (vem de `ANIME_PT_DUB_PROVIDERS`)
 * @returns {boolean}
 */
export function isPortugueseDubProvider(provider, listaPt = []) {
  const nome = String(provider || "").trim().toLowerCase();
  if (!nome) return false;
  return listaPt.map((p) => String(p).trim().toLowerCase()).includes(nome);
}

/**
 * Reordena os providers para procurar a dublagem PT-BR PRIMEIRO.
 *
 * Só reordena quando a faixa pedida é a dublada: é o único caso em que o idioma
 * da dublagem importa. Os providers PT-BR mantêm a ordem relativa entre si
 * (a preferência configurada em `ANIME_PROVIDERS` é preservada) e os restantes
 * passam para trás, como rede de segurança — um título que só exista num site
 * inglês continua a ser alcançável.
 *
 * Sem faixa pedida devolve a lista intacta: a ordem configurada já tem o
 * provider PT-BR à frente, e reordenar por uma faixa que não foi pedida seria
 * impor uma escolha que o utilizador não fez.
 *
 * Puro (sem rede) para poder ser testado.
 *
 * @param {Array<{nome: string}>} providers
 * @param {string} [audioVersion] faixa pedida ("dubbed" reordena)
 * @param {string[]} [listaPt]
 * @returns {Array<{nome: string}>} nova lista (a original não é alterada)
 */
export function ordenarProvidersParaFaixa(
  providers = [],
  audioVersion = "",
  listaPt = [],
) {
  const lista = Array.isArray(providers) ? providers : [];
  const faixa = String(audioVersion || "").trim().toLowerCase();

  if (faixa !== AUDIO_DUBBED) return [...lista];

  const pt = [];
  const resto = [];

  for (const provider of lista) {
    if (isPortugueseDubProvider(provider?.nome, listaPt)) pt.push(provider);
    else resto.push(provider);
  }

  return [...pt, ...resto];
}

/**
 * Nome próprio de uma faixa, para o card ("subbed" → "Legendado").
 *
 * O AnimeGG e o AniTube publicam as duas faixas em inglês; o utilizador do bot
 * fala português, pelo que o rótulo é traduzido. Um valor desconhecido é
 * devolvido como veio, para nunca esconder uma faixa nova do provider.
 *
 * @param {string} versao
 * @returns {string}
 */
export function audioVersionLabel(versao) {
  const valor = String(versao || "").trim().toLowerCase();
  if (valor === AUDIO_SUBBED) return "Legendado";
  if (valor === AUDIO_DUBBED) return "Dublado";
  return valor;
}

/**
 * Rótulo da faixa para o card, com o IDIOMA quando é dublagem confirmada PT-BR.
 *
 * A faixa dublada existe em vários sites, mas o idioma dessa dublagem é do
 * SITE: o animesonlinehd e o anitube dublam em português, o animegg em inglês.
 * Marcar "Dublado (PT-BR)" só quando é mesmo português evita prometer o idioma
 * errado; nos restantes fica "Dublado", sem afirmar um idioma que não se sabe.
 *
 * @param {string} versao
 * @param {string} provider
 * @param {string[]} [listaPt]
 * @returns {string}
 */
export function audioTrackLabel(versao, provider, listaPt = []) {
  const rotulo = audioVersionLabel(versao);
  if (rotulo !== "Dublado") return rotulo;
  return isPortugueseDubProvider(provider, listaPt) ? "Dublado (PT-BR)" : rotulo;
}

/**
 * Aviso de IDIOMA quando a faixa dublada servida não é PT-BR.
 *
 * A faixa ("dubbed") é um booleano no site, mas o idioma dessa dublagem é uma
 * propriedade do SITE: o animesonlinehd e o anitube dublam em português, o
 * animegg em inglês. Sem este aviso, quem pede "Dublado" pode receber áudio
 * inglês com o card a dizer "Dublado" — o utilizador só o descobre pelo som.
 *
 * Devolve "" sempre que não há nada a dizer: faixa legendada, ou provider que
 * dubla em PT-BR. Só fala quando há uma diferença real a comunicar.
 *
 * Puro (sem rede) para poder ser testado.
 *
 * @param {string} faixa
 * @param {string} provider
 * @param {string[]} [listaPt]
 * @returns {string} "" quando não há aviso
 */
export function avisoIdiomaDublagem(faixa, provider, listaPt = []) {
  if (String(faixa || "").trim().toLowerCase() !== AUDIO_DUBBED) return "";
  if (isPortugueseDubProvider(provider, listaPt)) return "";

  return (
    "\n⚠️ A dublagem desta fonte é em inglês. Vou tentar as fontes de " +
    "dublagem PT-BR primeiro; se não tiverem, o áudio fica em inglês."
  );
}

/**
 * Faixas publicadas em PELO MENOS um episódio da lista (união, não intersecção).
 *
 * A escolha é feita UMA vez, antes da lista, e não em cada episódio. Exigir que
 * TODOS os episódios tivessem as duas faixas parecia mais seguro, mas escondia a
 * escolha quase sempre: o fragmento da faixa só cobre parte da lista (o One Piece
 * tem 583 episódios com as duas, 577 só legendado e 2 só dublado) e há séries
 * inteiras que não o trazem em nenhum. A união é o que o utilizador vê no site:
 * se algum episódio tem dublado, ele pode escolher dublado. Num episódio sem
 * dublagem o download falha com uma mensagem clara, o que é melhor do que o menu
 * nunca chegar a perguntar.
 *
 * Uma lista sem informação de faixa devolve `[]` e o fluxo segue como antes.
 *
 * @param {Array<{versions?: string[]}>} episodes
 * @returns {string[]} por ordem de `AUDIO_VERSIONS`
 */
export function availableAudioVersions(episodes = []) {
  const lista = Array.isArray(episodes) ? episodes : [];
  const presentes = new Set();

  for (const episode of lista) {
    const versoes = Array.isArray(episode?.versions) ? episode.versions : [];

    for (const versao of versoes) {
      const valor = String(versao || "").trim().toLowerCase();
      if (valor) presentes.add(valor);
    }
  }

  return AUDIO_VERSIONS.filter((versao) => presentes.has(versao));
}

/**
 * Monta as linhas da escolha de faixa.
 *
 * A linha do dublado promete "PT-BR sempre que existir", não "português": a
 * escolha acontece ANTES de a fonte ser conhecida e nem todo o site que publica
 * dublado o faz em português (o animegg dubla em inglês). A procura tenta os
 * sites PT-BR primeiro, mas afirmar o idioma aqui seria prometer o que a fonte
 * ainda não confirmou — o card final é que diz o idioma real.
 *
 * @param {string[]} versions
 * @returns {Array<{id: string, title: string, description: string}>}
 */
export function buildAudioRows(versions = []) {
  return AUDIO_VERSIONS.filter((versao) =>
    versions.map((v) => String(v).toLowerCase()).includes(versao),
  ).map((versao) => ({
    id: `anm:aud:${versao}`,
    title: audioVersionLabel(versao),
    description:
      versao === AUDIO_DUBBED
        ? "Áudio PT-BR sempre que existir"
        : "Áudio original com legendas",
  }));
}

/**
 * Nomes próprios dos providers, para o card não mostrar "Animeheaven".
 */
const PROVIDER_LABELS = {
  anikoto: "Anikoto",
  animeheaven: "AnimeHeaven",
  animegg: "AnimeGG",
  anitube: "AniTube",
  animeunity: "AnimeUnity",
  animepahe: "AnimePahe",
  hianime: "HiAnime",
  animekai: "AnimeKai",
  kickassanime: "KickAssAnime",
  animesaturn: "AnimeSaturn",
  animesama: "AnimeSama",
};

/**
 * Rótulo legível de um provider de animes ("animeunity" → "AnimeUnity").
 *
 * @param {string} provider
 * @returns {string}
 */
export function animeProviderLabel(provider) {
  const nome = String(provider || "").trim();
  if (!nome) return "Animes";
  return PROVIDER_LABELS[nome.toLowerCase()] || nome.charAt(0).toUpperCase() + nome.slice(1);
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
 * Número de páginas necessárias para listar todos os episódios.
 *
 * O WhatsApp descarta listas demasiado longas, por isso os episódios são
 * paginados em vez de enviados de uma vez.
 *
 * @param {Array<unknown>} episodes
 * @param {number} [perPage]
 * @returns {number} no mínimo 1
 */
export function episodePageCount(episodes = [], perPage = EPISODES_PER_PAGE) {
  return Math.max(1, Math.ceil(episodes.length / perPage));
}

/**
 * Monta as linhas da lista de temporadas.
 *
 * O `id` usa o índice (`anm:sea:<i>`) e o slug real fica na sessão: os slugs
 * são longos e o WhatsApp descarta `rowId`s grandes.
 *
 * @param {Array<{slug: string, title: string}>} seasons
 * @returns {Array<{id: string, title: string, description: string, slug: string}>}
 */
export function buildSeasonRows(seasons = []) {
  return seasons.map((temporada, index) => ({
    id: `anm:sea:${index}`,
    title: String(temporada?.title || `Temporada ${index + 1}`).slice(0, 60),
    description: "Escolher esta temporada",
    slug: String(temporada?.slug || ""),
  }));
}

/**
 * Monta as linhas da lista de episódios de uma página.
 *
 * O `id` usa o índice ABSOLUTO (`anm:ep:<i>`), não a posição na página: assim
 * `session.episodes[i]` resolve sempre o episódio certo, em qualquer página.
 *
 * @param {Array<{id: string, number?: number, title?: string}>} episodes
 * @param {number} [page] página (base 0)
 * @param {number} [perPage]
 * @returns {Array<{id: string, title: string, description: string, episodeId: string}>}
 */
export function buildEpisodeRows(
  episodes = [],
  page = 0,
  perPage = EPISODES_PER_PAGE,
) {
  const inicio = page * perPage;

  return episodes
    .slice(inicio, inicio + perPage)
    .map((episode, offset) => {
      const index = inicio + offset;
      const numero = episode?.number ?? index + 1;
      const titulo = String(episode?.title || "").trim();
      const jaTemNumero = new RegExp(`epis[oó]dio\\s*${numero}`, "i").test(titulo);

      return {
        id: `anm:ep:${index}`,
        title: `Episódio ${numero}`.slice(0, 60),
        description: (
          jaTemNumero ? titulo || "Ver episódio" : titulo || "Ver episódio"
        ).slice(0, 72),
        episodeId: String(episode?.id || ""),
      };
    });
}

/**
 * Linha única "Ver mais episódios", no fundo da lista, quando ainda faltam
 * episódios por mostrar. Sem botão de retroceder: a lista curta é o objetivo,
 * e quem quiser os anteriores volta a pesquisar o anime.
 *
 * @param {number} page página atual (base 0)
 * @param {number} totalPages
 * @returns {Array<{id: string, title: string, description: string}>} vazio na última página
 */
export function buildNextPageRow(page, totalPages) {
  if (page + 1 >= totalPages) return [];

  const proxima = page + 1;
  const ultima = proxima + 1 === totalPages;

  return [
    {
      id: `anm:pg:${proxima}`,
      title: "➡️ Ver mais episódios",
      description: `${ultima ? "Últimos episódios" : "Mais episódios"} · página ${
        proxima + 1
      } de ${totalPages}`,
    },
  ];
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
