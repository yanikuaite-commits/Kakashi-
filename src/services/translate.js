/**
 * Tradução de títulos para a língua que os sites de animes entendem.
 *
 * O utilizador escreve em português ("Meu Hero Academia") e o catálogo dos
 * sites está indexado pelo título em inglês/romaji ("Boku no Hero Academia").
 * Sem esta camada, a pesquisa devolvia o primeiro resultado do site, que pode
 * ser um anime COMPLETAMENTE diferente — "Meu Hero Academia" caía em
 * "Eiyuu Kyoushitsu".
 *
 * A tradução é usada como ÚLTIMO RECURSO pelo `searchAnime`: primeiro procura-se
 * o termo como o utilizador o escreveu (o `meusanimes` já indexa muitos aliases
 * PT, "Ataque dos Titãs" → "Shingeki No Kyojin"), e só quando não há
 * correspondência exata é que o termo é traduzido. Isto evita estragar o que já
 * funcionava: "Naruto", "One Piece" e "Shingeki No Kyojin" passam pela tradução
 * inalterados (verificado), mas mesmo que não passassem não seriam tocados.
 *
 * A tradução NUNCA lança: sem rede (ou com a API em baixo) devolve `null` e o
 * fluxo segue com o termo original. Uma falha de tradução não pode impedir um
 * download.
 *
 * @author Dev Yanik
 */
import { ANIME_USER_AGENT, TRANSLATE_TIMEOUT_MS } from "../config.js";
import { errorLog, infoLog } from "../utils/logger.js";

const ENDPOINT = "https://translate.googleapis.com/translate_a/single";

/**
 * Traduz um texto para inglês, devolvendo `null` quando não vale a pena usar o
 * resultado (falha, texto vazio, ou texto igual ao original).
 *
 * `sl=auto` (e não `pt`) é deliberado: o termo pode já estar em inglês ou ser
 * um romaji japonês, e forçar `sl=pt` arriscaria "traduzir" um título que já
 * estava na forma certa. Com `auto`, só o que o serviço reconhece como outra
 * língua muda.
 *
 * @param {string} texto
 * @returns {Promise<string|null>} tradução, ou `null` se não houver ganho
 */
export async function translateToEnglish(texto) {
  const original = String(texto || "").trim();
  if (!original) return null;

  const url =
    `${ENDPOINT}?client=gtx&dt=t&sl=auto&tl=en&q=${encodeURIComponent(original)}`;

  try {
    const resposta = await fetch(url, {
      signal: AbortSignal.timeout(TRANSLATE_TIMEOUT_MS),
      headers: { "User-Agent": ANIME_USER_AGENT },
    });

    if (!resposta.ok) {
      errorLog(`[translate] HTTP ${resposta.status} ao traduzir "${original}"`);
      return null;
    }

    const dados = await resposta.json();
    const traduzido = (dados?.[0] || [])
      .map((parte) => parte?.[0] || "")
      .join("")
      .trim();

    // Tradução igual (ou vazia) não traz informação nova: quem chama só quer
    // um termo DIFERENTE para tentar. Devolver o mesmo texto faria a pesquisa
    // repetir a mesma consulta sem necessidade.
    if (!traduzido || traduzido.toLowerCase() === original.toLowerCase()) {
      return null;
    }

    infoLog(`[translate] "${original}" → "${traduzido}"`);
    return traduzido;
  } catch (error) {
    errorLog(`[translate] falha ao traduzir "${original}": ${error.message}`);
    return null;
  }
}
