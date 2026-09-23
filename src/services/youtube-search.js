import youtubeSearch from "youtube-search-api";

export async function searchYouTube(term, limit = 5, searcher = youtubeSearch) {
  const query = String(term || "").trim();
  if (!query) throw new Error("Informe um termo para pesquisar no YouTube.");

  let results;
  try {
    results = await searcher.GetListByKeyword(query, false, limit + 5, [{ type: "video" }]);
  } catch (error) {
    throw new Error("Não foi possível pesquisar no YouTube agora. Tente novamente.", { cause: error });
  }

  return (results?.items || [])
    .filter((video) => video.type === "video" && /^[\w-]{11}$/.test(video.id))
    .slice(0, limit)
    .map((video) => ({
      title: video.title || "Sem título",
      url: `https://www.youtube.com/watch?v=${video.id}`,
      duration: video.length?.simpleText || "Duração indisponível",
      thumbnail: video.thumbnail?.thumbnails?.at(-1)?.url || null,
      artist: video.channelTitle || "Artista desconhecido",
    }));
}
