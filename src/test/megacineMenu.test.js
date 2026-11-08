/**
 * Testes do fluxo do Saimo TV (séries/doramas): navegação, tokens e o passo que
 * salta a lista quando só há uma opção.
 *
 * A rede é substituída por um stub local (`globalThis.fetch`) com o catálogo
 * REAL do saimo (ficheiros `.txt` separados por TAB), para o teste exercitar o
 * caminho verdadeiro — parsing incluído — sem depender de um site de terceiros
 * estar no ar. O yt-dlp é substituído por um módulo falso porque o download real
 * precisa de rede e de disco.
 *
 * @author Dev Yanik
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";

process.env.SAIMO_CATALOG_BASE = "https://catalogo.saimo.test";

// Índice geral: título, tipo (f=filme, s=série), letra, ano.
const BUSCA = [
  "The Boys\ts\tT\t2019",
  "The Boys Apresenta: Diabólicos\ts\tT\t2022",
  "Duna A Profecia\ts\tD\t2024",
  "Matrix\tf\tM\t1999",
  "Matrix Reloaded\tf\tM\t2003",
  "Dual Show\ts\tZ\t2020",
].join("\n");

// Índice da letra T: título, ano, pedaço, episódios.
const SERIES_T = [
  "The Boys\t2019\t0\t4",
  "The Boys Apresenta: Diabólicos\t2022\t1\t1",
].join("\n");

const SERIES_D = "Duna A Profecia\t2024\t0\t1";

// Dual Show: dois episódios na T1, o primeiro com dublado E legendado.
const SERIES_Z = "Dual Show\t2020\t0\t2";

// Filmes da letra M. "Matrix" traz as DUAS faixas (dub e leg); "Matrix Reloaded"
// só legendado — é o caso que testa a queda sem escolha.
const FILMES_M = [
  "Matrix\tdub=http://cdn.saimo.test/matrix-dub.mp4,http://cdn.saimo.test/matrix-dub2.mp4\tleg=http://cdn.saimo.test/matrix-leg.mp4",
  "Matrix Reloaded\tleg=http://cdn.saimo.test/reloaded-leg.mp4",
].join("\n");

// Fichas: base das capas e o pôster de cada título (formato do site).
const FICHAS = [
  "# Ficha de cada título.",
  "capa: https://image.tmdb.org/t/p/w342",
  "# tipo  título  id  pôster  gêneros",
  "s\tThe Boys\t76479\t/the-boys.jpg\tAção,Drama",
  "s\tDual Show\t99999\t/dual-show.jpg\tDrama",
].join("\n");

// The Boys: duas temporadas, dois episódios cada.
const EPISODIOS_THE_BOYS = [
  "@The Boys\t2019",
  "1\t1\tdub\thttp://cdn.saimo.test/the-boys-s01e01.mp4",
  "1\t2\tdub\thttp://cdn.saimo.test/the-boys-s01e02.mp4",
  "2\t1\tdub\thttp://cdn.saimo.test/the-boys-s02e01.mp4",
  "2\t2\tdub\thttp://cdn.saimo.test/the-boys-s02e02.mp4",
].join("\n");

// Uma temporada, um só episódio: o fluxo salta a lista e vai ao download.
const EPISODIO_UNICO = [
  "@The Boys Apresenta: Diabólicos\t2022",
  "1\t1\tdub\thttp://cdn.saimo.test/diabolicos-s01e01.mp4",
].join("\n");

const EPISODIOS_DUNA = [
  "@Duna A Profecia\t2024",
  "1\t1\tdub\thttp://cdn.saimo.test/duna-s01e01.mp4",
].join("\n");

// Dual Show: o ep. 1 traz as DUAS faixas; o ep. 2 só legendado.
const EPISODIOS_DUAL = [
  "@Dual Show\t2020",
  "1\t1\tdub\thttp://cdn.saimo.test/dual-s01e01-dub.mp4",
  "1\t1\tleg\thttp://cdn.saimo.test/dual-s01e01-leg.mp4",
  "1\t2\tleg\thttp://cdn.saimo.test/dual-s01e02-leg.mp4",
].join("\n");

/** Substitui a rede por respostas fixas, conforme o URL pedido. */
function stubFetch({ playlistOk = true, chamadas = [], extras = {} } = {}) {
  return mock.method(globalThis, "fetch", async (url) => {
    const alvo = String(url);
    chamadas.push(alvo);

    const responder = (corpo) => ({
      ok: true,
      status: 200,
      text: async () => corpo,
    });

    for (const [chave, corpo] of Object.entries(extras)) {
      if (alvo.includes(chave)) return responder(corpo);
    }

    if (alvo.endsWith("/busca.txt")) return responder(BUSCA);
    if (alvo.endsWith("/fichas.txt")) return responder(FICHAS);
    if (alvo.endsWith("/series-T.txt")) return responder(SERIES_T);
    if (alvo.endsWith("/series-D.txt")) return responder(SERIES_D);
    if (alvo.endsWith("/series-Z.txt")) return responder(SERIES_Z);
    if (alvo.endsWith("/series-T-0.txt")) return responder(EPISODIOS_THE_BOYS);
    if (alvo.endsWith("/series-T-1.txt")) return responder(EPISODIO_UNICO);
    if (alvo.endsWith("/series-D-0.txt")) return responder(EPISODIOS_DUNA);
    if (alvo.endsWith("/series-Z-0.txt")) return responder(EPISODIOS_DUAL);
    if (alvo.endsWith("/filmes-M.txt")) return responder(FILMES_M);

    // CDN do vídeo: responde (ou não) conforme `playlistOk`.
    if (alvo.includes("cdn.saimo.test")) {
      return playlistOk
        ? responder("x")
        : { ok: false, status: 403, text: async () => "403" };
    }

    return { ok: false, status: 404, text: async () => "404" };
  });
}

const fakeSocket = { sendMessage: async () => ({ key: { id: "x" } }) };

async function abrir(termo = "the boys") {
  const { startMegacineFlow } = await import("../utils/megacineMenu.js");
  const replies = [];
  await startMegacineFlow({
    socket: fakeSocket,
    chatId: "mgc-test@g.us",
    ownerLid: "5511999999999@lid",
    ownerName: "Teste",
    sendReply: async (texto) => {
      replies.push(texto);
    },
    nome: termo,
    textOnly: true,
  });
  return replies;
}

test.beforeEach(async () => {
  const { resetMegacineSessions } = await import("../utils/megacineMenu.js");
  const { limparCacheSaimo } = await import("../services/saimo.js");
  resetMegacineSessions();
  // O catálogo é cacheado em memória; entre testes tem de ser relido, senão um
  // fixture de um teste vaza para o seguinte.
  limparCacheSaimo();
});

test.afterEach(() => mock.restoreAll());

test("a pesquisa lista os resultados e guarda as linhas", async () => {
  stubFetch();
  const { getMegacineSession } = await import("../utils/megacineMenu.js");

  const replies = await abrir("the boys");

  assert.ok(
    replies.some((r) => r.includes("The Boys")),
    "o card deve trazer o título",
  );

  const session = getMegacineSession("mgc-test@g.us", "5511999999999@lid");
  assert.equal(session.stage, "candidatos");
  assert.equal(session.candidates.length, 2);
  assert.ok(session.lastRows.length >= 2, "as linhas ficam guardadas para o modo texto");
});

test("escolher a série lista as temporadas", async () => {
  stubFetch();
  const { handleMegacineReply, getMegacineSession } = await import(
    "../utils/megacineMenu.js"
  );

  await abrir("the boys");
  await handleMegacineReply({
    socket: fakeSocket,
    chatId: "mgc-test@g.us",
    senderLid: "5511999999999@lid",
    text: "mgc:an:0",
    sendReply: async () => {},
  });

  const session = getMegacineSession("mgc-test@g.us", "5511999999999@lid");
  assert.equal(session.stage, "temporadas");
  assert.equal(session.seasons.length, 2);
});

test("a série lista episódios depois da temporada", async () => {
  stubFetch();
  const { handleMegacineReply, getMegacineSession } = await import(
    "../utils/megacineMenu.js"
  );

  await abrir("the boys");
  await handleMegacineReply({
    socket: fakeSocket,
    chatId: "mgc-test@g.us",
    senderLid: "5511999999999@lid",
    text: "mgc:an:0",
    sendReply: async () => {},
  });
  await handleMegacineReply({
    socket: fakeSocket,
    chatId: "mgc-test@g.us",
    senderLid: "5511999999999@lid",
    text: "mgc:sea:1",
    sendReply: async () => {},
  });

  const session = getMegacineSession("mgc-test@g.us", "5511999999999@lid");
  assert.equal(session.stage, "episodios");
  assert.equal(session.seasonNumber, 2);
  assert.deepEqual(
    session.episodes.map((e) => e.number),
    [1, 2],
  );
});

test("a escolha por número vale a linha do último card", async () => {
  stubFetch();
  const { handleMegacineReply, getMegacineSession } = await import(
    "../utils/megacineMenu.js"
  );

  await abrir("the boys");
  // "1" = primeiro resultado (The Boys), sem tocar em botões. A série tem duas
  // temporadas, por isso a sessão fica em "temporadas" — prova que o número
  // foi resolvido para o token da linha certa.
  await handleMegacineReply({
    socket: fakeSocket,
    chatId: "mgc-test@g.us",
    senderLid: "5511999999999@lid",
    text: "1",
    sendReply: async () => {},
  });

  const session = getMegacineSession("mgc-test@g.us", "5511999999999@lid");
  assert.equal(session.title.title, "The Boys");
  assert.equal(session.stage, "temporadas");
});

test("a escolha por número funciona também nas temporadas", async () => {
  stubFetch();
  const { handleMegacineReply, getMegacineSession } = await import(
    "../utils/megacineMenu.js"
  );

  await abrir("the boys");
  await handleMegacineReply({
    socket: fakeSocket,
    chatId: "mgc-test@g.us",
    senderLid: "5511999999999@lid",
    text: "mgc:an:0",
    sendReply: async () => {},
  });
  // "2" = segunda temporada da lista.
  await handleMegacineReply({
    socket: fakeSocket,
    chatId: "mgc-test@g.us",
    senderLid: "5511999999999@lid",
    text: "2",
    sendReply: async () => {},
  });

  const session = getMegacineSession("mgc-test@g.us", "5511999999999@lid");
  assert.equal(session.seasonNumber, 2);
  assert.equal(session.stage, "episodios");
});

test("o cancelamento fecha a sessão", async () => {
  stubFetch();
  const { handleMegacineReply, getMegacineSession } = await import(
    "../utils/megacineMenu.js"
  );

  await abrir("the boys");
  await handleMegacineReply({
    socket: fakeSocket,
    chatId: "mgc-test@g.us",
    senderLid: "5511999999999@lid",
    text: "mgc:cancel",
    sendReply: async () => {},
  });

  assert.equal(getMegacineSession("mgc-test@g.us", "5511999999999@lid"), null);
});

test("um token sem sessão avisa que expirou", async () => {
  stubFetch();
  const { handleMegacineReply } = await import("../utils/megacineMenu.js");

  const replies = [];
  const tratado = await handleMegacineReply({
    socket: fakeSocket,
    chatId: "outro@g.us",
    senderLid: "5511888888888@lid",
    text: "mgc:ep:0",
    sendReply: async (t) => {
      replies.push(t);
    },
  });

  assert.equal(tratado, true);
  assert.ok(replies.some((r) => r.includes("expirou")));
});

test("texto que não é token nem número segue o fluxo normal", async () => {
  stubFetch();
  const { handleMegacineReply } = await import("../utils/megacineMenu.js");

  const tratado = await handleMegacineReply({
    socket: fakeSocket,
    chatId: "vazio@g.us",
    senderLid: "5511777777777@lid",
    text: "bom dia pessoal",
    sendReply: async () => {},
  });

  assert.equal(tratado, false, "o bot não responde a mensagens soltas do grupo");
});

test("o estado aguardando_nome aceita o nome escrito no chat", async () => {
  stubFetch();
  const { startMegacineFlow, handleMegacineReply, getMegacineSession } =
    await import("../utils/megacineMenu.js");

  await startMegacineFlow({
    socket: fakeSocket,
    chatId: "nome-test@g.us",
    ownerLid: "5511999999999@lid",
    sendReply: async () => {},
    nome: "",
    textOnly: true,
  });

  const antes = getMegacineSession("nome-test@g.us", "5511999999999@lid");
  assert.equal(antes.stage, "aguardando_nome");

  await handleMegacineReply({
    socket: fakeSocket,
    chatId: "nome-test@g.us",
    senderLid: "5511999999999@lid",
    text: "the boys",
    sendReply: async () => {},
  });

  const depois = getMegacineSession("nome-test@g.us", "5511999999999@lid");
  assert.equal(depois.stage, "candidatos");
});

test("um comando com prefixo não é tratado como nome", async () => {
  stubFetch();
  const { startMegacineFlow, handleMegacineReply, getMegacineSession } =
    await import("../utils/megacineMenu.js");

  await startMegacineFlow({
    socket: fakeSocket,
    chatId: "pfx@g.us",
    ownerLid: "5511999999999@lid",
    sendReply: async () => {},
    nome: "",
    textOnly: true,
  });

  const tratado = await handleMegacineReply({
    socket: fakeSocket,
    chatId: "pfx@g.us",
    senderLid: "5511999999999@lid",
    text: ".menu",
    sendReply: async () => {},
    prefix: ".",
  });

  assert.equal(tratado, false, "o comando deve seguir para o fluxo normal");
  assert.equal(getMegacineSession("pfx@g.us", "5511999999999@lid"), null);
});

test("um título de episódio único salta direto para o download", async () => {
  stubFetch();
  const { handleMegacineReply, getMegacineSession } = await import(
    "../utils/megacineMenu.js"
  );

  await abrir("the boys");
  // Duna = segundo resultado: uma temporada com um só episódio.
  await handleMegacineReply({
    socket: fakeSocket,
    chatId: "mgc-test@g.us",
    senderLid: "5511999999999@lid",
    text: "mgc:an:1",
    sendReply: async () => {},
  });

  const session = getMegacineSession("mgc-test@g.us", "5511999999999@lid");
  // A sessão é largada no início do download (o download é o último passo).
  assert.equal(session, null, "não fica preso num menu de episódio de um item só");
});

test("a pesquisa oferece filmes, marcados como tal", async () => {
  stubFetch();
  const { getMegacineSession } = await import("../utils/megacineMenu.js");

  const replies = await abrir("matrix");
  const session = getMegacineSession("mgc-test@g.us", "5511999999999@lid");

  assert.deepEqual(
    session.candidates.map((c) => c.title),
    ["Matrix", "Matrix Reloaded"],
    "o filme aparece nas opções, ao contrário do comportamento antigo",
  );
  assert.ok(
    session.candidates.every((c) => c.tipo === "filme"),
    "o tipo viaja na candidata, para o fluxo saber que não é uma série",
  );
  assert.ok(
    session.lastRows.some((r) => String(r.description || "").includes("🎬 Filme")),
    "a linha distingue filme de série",
  );
});

test("um filme salta as temporadas e pergunta a qualidade", async () => {
  stubFetch();
  const { handleMegacineReply, getMegacineSession } = await import(
    "../utils/megacineMenu.js"
  );

  await abrir("matrix");
  const replies = [];
  await handleMegacineReply({
    socket: fakeSocket,
    chatId: "mgc-test@g.us",
    senderLid: "5511999999999@lid",
    text: "mgc:an:0",
    sendReply: async (t) => replies.push(t),
  });

  const session = getMegacineSession("mgc-test@g.us", "5511999999999@lid");
  // "Matrix" tem as duas faixas, por isso o passo seguinte é o áudio.
  assert.equal(session.stage, "faixas");
  assert.equal(session.filme, true);
  assert.deepEqual(session.audioVersions, ["dubbed", "subbed"]);
});

test("escolhida a faixa do filme, pergunta a qualidade", async () => {
  stubFetch();
  const { handleMegacineReply, getMegacineSession } = await import(
    "../utils/megacineMenu.js"
  );

  await abrir("matrix");
  await handleMegacineReply({
    socket: fakeSocket,
    chatId: "mgc-test@g.us",
    senderLid: "5511999999999@lid",
    text: "mgc:an:0",
    sendReply: async () => {},
  });
  const replies = [];
  await handleMegacineReply({
    socket: fakeSocket,
    chatId: "mgc-test@g.us",
    senderLid: "5511999999999@lid",
    text: "mgc:fil:dubbed",
    sendReply: async (t) => replies.push(t),
  });

  const session = getMegacineSession("mgc-test@g.us", "5511999999999@lid");
  assert.equal(session.stage, "qualidade");
  assert.equal(session.audioVersion, "dubbed");
  assert.ok(replies.some((r) => r.includes("720p")), "oferece a qualidade 720p");
});

test("um filme só legendado não pergunta a faixa, vai direto à qualidade", async () => {
  stubFetch();
  const { handleMegacineReply, getMegacineSession } = await import(
    "../utils/megacineMenu.js"
  );

  await abrir("matrix reloaded");
  await handleMegacineReply({
    socket: fakeSocket,
    chatId: "mgc-test@g.us",
    senderLid: "5511999999999@lid",
    text: "mgc:an:0",
    sendReply: async () => {},
  });

  const session = getMegacineSession("mgc-test@g.us", "5511999999999@lid");
  assert.equal(session.stage, "qualidade", "sem escolha de faixa, salta o passo");
  assert.equal(session.audioVersion, "subbed", "a única faixa fica fixada sozinha");
});

test("a pesquisa sem resultados avisa e fecha a sessão", async () => {
  mock.method(globalThis, "fetch", async () => ({
    ok: true,
    status: 200,
    text: async () => "<div>Nada encontrado</div>",
  }));

  const { getMegacineSession } = await import("../utils/megacineMenu.js");
  const replies = await abrir("xyzabc");

  assert.ok(replies.some((r) => r.includes("Não encontrei")));
  assert.equal(getMegacineSession("mgc-test@g.us", "5511999999999@lid"), null);
});

test("um stream inacessível avisa e não arranca o download", async () => {
  stubFetch({ playlistOk: false });
  const { handleMegacineReply, getMegacineSession } = await import(
    "../utils/megacineMenu.js"
  );

  const replies = [];
  const sendReply = async (t) => {
    replies.push(t);
  };

  await abrir("the boys");
  await handleMegacineReply({
    socket: fakeSocket,
    chatId: "mgc-test@g.us",
    senderLid: "5511999999999@lid",
    text: "mgc:an:0",
    sendReply,
  });
  await handleMegacineReply({
    socket: fakeSocket,
    chatId: "mgc-test@g.us",
    senderLid: "5511999999999@lid",
    text: "mgc:sea:0",
    sendReply,
  });
  await handleMegacineReply({
    socket: fakeSocket,
    chatId: "mgc-test@g.us",
    senderLid: "5511999999999@lid",
    text: "mgc:ep:0",
    sendReply,
  });

  assert.ok(
    replies.some((r) => r.includes("não respondeu")),
    "a verificação da playlist evita cobrar créditos por um download impossível",
  );
  assert.ok(
    !replies.some((r) => r.includes("Baixando")),
    "o download nem chega a arrancar",
  );
  assert.equal(getMegacineSession("mgc-test@g.us", "5511999999999@lid"), null);
});

test("a paginação lista os episódios restantes", async () => {
  // Uma temporada com 12 episódios: a primeira página mostra 10 e a segunda 2.
  const muitos = Array.from(
    { length: 12 },
    (_, i) => `1\t${i + 1}\tdub\thttp://cdn.saimo.test/the-boys-s01e${String(i + 1).padStart(2, "0")}.mp4`,
  ).join("\n");

  stubFetch({
    extras: { "/series-T-0.txt": `@The Boys\t2019\n${muitos}` },
  });

  const { handleMegacineReply, getMegacineSession } = await import(
    "../utils/megacineMenu.js"
  );

  const replies = [];
  const sendReply = async (t) => {
    replies.push(t);
  };

  await abrir("the boys");
  await handleMegacineReply({
    socket: fakeSocket,
    chatId: "mgc-test@g.us",
    senderLid: "5511999999999@lid",
    text: "mgc:an:0",
    sendReply,
  });

  const session = getMegacineSession("mgc-test@g.us", "5511999999999@lid");
  assert.equal(session.episodes.length, 12);
  assert.equal(session.page, 0);
  assert.ok(
    replies.some((r) => r.includes("Ver mais episódios")),
    "a primeira página deve trazer o botão de continuar",
  );

  await handleMegacineReply({
    socket: fakeSocket,
    chatId: "mgc-test@g.us",
    senderLid: "5511999999999@lid",
    text: "mgc:pg:1",
    sendReply,
  });

  assert.equal(
    getMegacineSession("mgc-test@g.us", "5511999999999@lid").page,
    1,
    "a segunda página é alcançável",
  );
});

test("a legenda não inventa uma qualidade que não existe", async () => {
  const { megacineCaption } = await import("../utils/megacineMenu.js");

  const caption = megacineCaption({ titulo: "The Boys — T1 Ep. 1", duracao: "1:02:03" });

  assert.ok(caption.includes("The Boys — T1 Ep. 1"), "traz o título do episódio");
  assert.ok(caption.includes("Saimo TV"), "traz a fonte");
  assert.ok(caption.includes("1:02:03"), "traz a duração");
  assert.ok(
    caption.includes("Melhor disponível"),
    "com uma só qualidade, anuncia o que é real em vez de um número inventado",
  );
});

test("os nomes do config usados pelo menu existem todos", async () => {
  // Regressão: `MEGACINE_MAX_HEIGHT` chegou a ser usado aqui depois de removido
  // do config. Como o erro caía no `catch` do download, o utilizador via
  // "não consegui baixar" em vez de um erro de programação.
  const config = await import("../config.js");
  const fs = await import("node:fs");
  const fonte = fs.readFileSync(
    new URL("../utils/megacineMenu.js", import.meta.url),
    "utf8",
  );

  const bloco = fonte.match(/import\s*\{([^}]+)\}\s*from\s*"\.\.\/config\.js"/);

  assert.ok(bloco, "o menu importa do config");

  // Cada nome usado tem de existir: importado do config, ou definido no próprio
  // ficheiro (`MEGACINE_TTL_MS` é local). Um nome usado e inexistente só rebenta
  // em execução, dentro do `catch` do download.
  const importados = bloco[1]
    .split(",")
    .map((nome) => nome.trim())
    .filter(Boolean);

  const usados = [...fonte.matchAll(/\b(MEGACINE_[A-Z0-9_]+)\b/g)].map((m) => m[1]);
  const locais = [
    ...fonte.matchAll(/(?:export\s+)?const\s+(MEGACINE_[A-Z0-9_]+)\s*=/g),
  ].map((m) => m[1]);

  for (const nome of new Set([...importados, ...usados])) {
    if (locais.includes(nome)) continue;

    assert.ok(
      Object.hasOwn(config, nome),
      `${nome} é usado no menu mas não existe em config.js`,
    );
  }
});

test("o envio usa o título como nome do ficheiro, não um nome fixo", async () => {
  // Regressão: o envio como documento trazia `fileName: "megacine.mp4"`, por isso
  // todos os episódios chegavam com o mesmo nome e o destinatário não conseguia
  // distingui-los. O título da pesquisa tem de alimentar o nome.
  const fs = await import("node:fs");

  for (const ficheiro of ["../utils/megacineMenu.js", "../utils/animeMenu.js"]) {
    const fonte = fs.readFileSync(new URL(ficheiro, import.meta.url), "utf8");
    const envios = [...fonte.matchAll(/fileName:\s*([^,\n]+)/g)].map((m) => m[1].trim());

    assert.ok(envios.length > 0, `${ficheiro} envia documentos com nome`);

    for (const valor of envios) {
      assert.ok(
        !/^["']/.test(valor),
        `${ficheiro} não pode fixar o nome do ficheiro (encontrado ${valor})`,
      );
      assert.match(
        valor,
        /safeMediaFileName|nomeArquivo/,
        `${ficheiro} tem de construir o nome a partir do título (encontrado ${valor})`,
      );
    }
  }
});

test("o resultado da pesquisa leva a capa do título (ficha do site)", async () => {
  stubFetch();
  const { getMegacineSession } = await import("../utils/megacineMenu.js");

  await abrir("the boys");
  const session = getMegacineSession("mgc-test@g.us", "5511999999999@lid");

  assert.equal(
    session.candidates[0].image,
    "https://image.tmdb.org/t/p/w342/the-boys.jpg",
    "a capa é montada a partir da ficha do título",
  );
});

test("um título com as duas faixas pergunta o áudio antes das temporadas", async () => {
  stubFetch();
  const { handleMegacineReply, getMegacineSession } = await import(
    "../utils/megacineMenu.js"
  );

  const replies = [];
  const sendReply = async (t) => replies.push(t);

  await abrir("dual show");
  await handleMegacineReply({
    socket: fakeSocket,
    chatId: "mgc-test@g.us",
    senderLid: "5511999999999@lid",
    text: "mgc:an:0",
    sendReply,
  });

  const session = getMegacineSession("mgc-test@g.us", "5511999999999@lid");

  assert.equal(session.stage, "faixas", "a faixa é perguntada antes de listar");
  assert.deepEqual(session.audioVersions, ["subbed", "dubbed"]);
  assert.ok(
    replies.some((r) => r.includes("Dublado") && r.includes("Legendado")),
    "o card oferece as duas faixas",
  );
});

test("a faixa escolhida fica fixada e o download usa-a", async () => {
  stubFetch();
  const { handleMegacineReply, getMegacineSession } = await import(
    "../utils/megacineMenu.js"
  );

  const sendReply = async () => {};
  await abrir("dual show");
  await handleMegacineReply({
    socket: fakeSocket,
    chatId: "mgc-test@g.us",
    senderLid: "5511999999999@lid",
    text: "mgc:an:0",
    sendReply,
  });
  await handleMegacineReply({
    socket: fakeSocket,
    chatId: "mgc-test@g.us",
    senderLid: "5511999999999@lid",
    text: "mgc:aud:subbed",
    sendReply,
  });

  const session = getMegacineSession("mgc-test@g.us", "5511999999999@lid");

  assert.equal(session.audioVersion, "subbed");
  assert.equal(session.stage, "episodios", "segue para a lista de episódios");
});

test("uma faixa inventada é recusada", async () => {
  stubFetch();
  const { handleMegacineReply, getMegacineSession } = await import(
    "../utils/megacineMenu.js"
  );

  const sendReply = async () => {};
  await abrir("dual show");
  await handleMegacineReply({
    socket: fakeSocket,
    chatId: "mgc-test@g.us",
    senderLid: "5511999999999@lid",
    text: "mgc:an:0",
    sendReply,
  });
  await handleMegacineReply({
    socket: fakeSocket,
    chatId: "mgc-test@g.us",
    senderLid: "5511999999999@lid",
    text: "mgc:aud:portugues",
    sendReply,
  });

  assert.equal(
    getMegacineSession("mgc-test@g.us", "5511999999999@lid"),
    null,
    "a sessão é fechada em vez de fixar uma faixa inexistente",
  );
});

test("a pesquisa pagina os resultados de 20 em 20 com ver mais", async () => {
  // 25 séries com o mesmo prefixo: a página 1 mostra 20 e sobra a "ver mais".
  const muitas = Array.from(
    { length: 25 },
    (_, i) => `Show ${String(i + 1).padStart(2, "0")}\ts\tZ\t2020`,
  ).join("\n");

  stubFetch({ extras: { "/busca.txt": muitas } });

  const { handleMegacineReply, getMegacineSession } = await import(
    "../utils/megacineMenu.js"
  );

  const replies = [];
  const sendReply = async (t) => replies.push(t);

  await abrir("show");
  const session = getMegacineSession("mgc-test@g.us", "5511999999999@lid");

  assert.equal(session.allCandidates.length, 25, "guarda todos os resultados");
  assert.equal(session.candidates.length, 20, "a página mostra 20");
  assert.ok(
    session.lastRows.some((r) => r.id === "mgc:pg2:1"),
    "há uma linha para a página seguinte",
  );

  await handleMegacineReply({
    socket: fakeSocket,
    chatId: "mgc-test@g.us",
    senderLid: "5511999999999@lid",
    text: "mgc:pg2:1",
    sendReply,
  });

  assert.equal(
    getMegacineSession("mgc-test@g.us", "5511999999999@lid").candidates.length,
    5,
    "a segunda página traz os restantes 5",
  );
});

/**
 * Regressão: "o menu das séries expira na hora de escolher dublado/legendado".
 *
 * `buildAudioRows` é partilhado com o fluxo de animes e emitia `anm:aud:<faixa>`
 * também aqui. Como o `handleAnimeReply` corre ANTES do `handleMegacineReply` e
 * reivindica todo o token `anm:`, tocar em Dublado/Legendado no menu de séries
 * caía no handler de animes, que sem sessão de anime responde
 * "menu de animes expirou" — a mensagem é imediata, não é o TTL.
 *
 * O teste fixa o CONTRATO: o token que o menu emite tem de pertencer ao fluxo
 * (prefixo `mgc`) e o handler de animes não o pode consumir.
 */
test("a faixa das séries emite token mgc: e o handler de animes não a rouba", async () => {
  stubFetch();
  const { handleMegacineReply, getMegacineSession } = await import(
    "../utils/megacineMenu.js"
  );
  const { handleAnimeReply } = await import("../utils/animeMenu.js");

  const replies = [];
  const sendReply = async (t) => replies.push(String(t));

  await abrir("dual show");
  await handleMegacineReply({
    socket: fakeSocket,
    chatId: "mgc-test@g.us",
    senderLid: "5511999999999@lid",
    text: "mgc:an:0",
    sendReply,
  });

  const session = getMegacineSession("mgc-test@g.us", "5511999999999@lid");
  assert.equal(session.stage, "faixas");

  const linhasFaixa = session.lastRows.filter((r) => /:aud:/.test(String(r.id)));
  assert.equal(linhasFaixa.length, 2, "oferece as duas faixas");
  assert.deepEqual(
    linhasFaixa.map((r) => r.id).sort(),
    ["mgc:aud:dubbed", "mgc:aud:subbed"],
    "o rowId pertence ao fluxo das séries, não ao dos animes",
  );

  // O que o menu emite é o que o utilizador toca: tem de chegar ao megacine.
  const escolhido = linhasFaixa.find((r) => r.id === "mgc:aud:subbed");

  replies.length = 0;
  const consumidoPelosAnimes = await handleAnimeReply({
    socket: fakeSocket,
    chatId: "mgc-test@g.us",
    senderLid: "5511999999999@lid",
    senderLids: ["5511999999999@lid"],
    text: escolhido.id,
    sendReply,
  });

  assert.equal(
    consumidoPelosAnimes,
    false,
    "o handler de animes não pode reivindicar um token das séries",
  );
  assert.equal(
    replies.some((r) => /expirou/i.test(r)),
    false,
    "sem a colisão, ninguém responde 'expirou'",
  );

  const consumidoPeloMegacine = await handleMegacineReply({
    socket: fakeSocket,
    chatId: "mgc-test@g.us",
    senderLid: "5511999999999@lid",
    senderLids: ["5511999999999@lid"],
    text: escolhido.id,
    sendReply,
  });

  assert.equal(consumidoPeloMegacine, true, "o megacine trata a escolha");
  assert.equal(
    getMegacineSession("mgc-test@g.us", "5511999999999@lid").audioVersion,
    "subbed",
    "a faixa fica fixada e o fluxo segue",
  );
});
