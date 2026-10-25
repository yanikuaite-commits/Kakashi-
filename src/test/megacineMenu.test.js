/**
 * Testes do fluxo do Megacine: navegação, tokens e o passo que salta a lista
 * quando só há uma opção.
 *
 * A rede é substituída por um stub local (`globalThis.fetch`) com HTML real do
 * site, para o teste exercitar o caminho verdadeiro — parsing incluído — sem
 * depender de um site de terceiros estar no ar. O yt-dlp é substituído por um
 * módulo falso porque o download real precisa de rede e de disco.
 *
 * @author Dev Gui
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";

process.env.MEGACINE_BASE_URL = "https://www.megacine.online";

const HTML_BUSCA = `
<article class="card"><a href="https://www.megacine.online/series/the-boys" class="card-link" aria-label="Abrir The Boys"><div class="poster-wrapper"><img class="poster-img" src="https://cdn.megacine.online/i/1.webp"></div><div class="card-body"><h3 class="card-title">The Boys</h3><p class="card-meta">2026 • Ação</p></div></a></article>
<article class="card"><a href="https://www.megacine.online/series/duna-a-profecia" class="card-link" aria-label="Abrir Duna" poster-wrapper><img class="poster-img" src="https://cdn.megacine.online/i/2.webp"></div><div class="card-body"><h3 class="card-title">Duna: A Profecia</h3><p class="card-meta">2026 • Drama</p></div></a></article>
<article class="card"><a href="https://www.megacine.online/series/matrix-1-1999" class="card-link" aria-label="Abrir Matrix"><div class="poster-wrapper"><img class="poster-img" src="https://cdn.megacine.online/i/3.webp"></div><div class="card-body"><h3 class="card-title">Matrix</h3><p class="card-meta">1999 • Filmes</p></div></a></article>
`;

// Série: duas temporadas, dois episódios cada.
const HTML_SERIE = `
<div class="episodes-modern-list episodes-modern-season-content active" data-season="1">
<a href="https://www.megacine.online/series/the-boys/temporada-01/episodio-01"></a>
<a href="https://www.megacine.online/series/the-boys/temporada-01/episodio-02"></a></div>
<div class="episodes-modern-list episodes-modern-season-content " data-season="2">
<a href="https://www.megacine.online/series/the-boys/temporada-02/episodio-01"></a>
<a href="https://www.megacine.online/series/the-boys/temporada-02/episodio-02"></a></div>
`;

// Série de temporada única: um só episódio, logo o fluxo salta a lista.
const HTML_SERIE_CURTA = `
<div class="episodes-modern-list episodes-modern-season-content active" data-season="1">
<a href="https://www.megacine.online/series/duna-a-profecia/temporada-01/episodio-01"></a></div>
`;

// Filme: um só "episódio", e a página declara "Assistir Filme".
const HTML_FILME = `
<a href="#" id="assistirplaybutton" class="play-btn">Assistir Filme</a>
<div class="episodes-modern-list episodes-modern-season-content active" data-season="1">
<a href="https://www.megacine.online/series/matrix-1-1999/temporada-01/episodio-01"></a></div>
`;

const BOTAO_SERIE = `<a href="#" id="assistirplaybutton" class="play-btn">Assistir Agora</a>`;

function htmlEpisodio(slug, tipo, temporada, episodio) {
  return `<script>var urlConfig = { base: "https://forks-${tipo}.madfirebox.shop", slug: "${slug}", tipo: "${tipo}", temporada: ${temporada}, episodio: ${episodio} };</script>`;
}

/** Substitui a rede por respostas fixas, conforme o URL pedido. */
function stubFetch({ playlistOk = true, chamadas = [] } = {}) {
  return mock.method(globalThis, "fetch", async (url) => {
    const alvo = String(url);
    chamadas.push(alvo);

    const responder = (corpo) => ({
      ok: true,
      status: 200,
      text: async () => corpo,
    });

    if (alvo.includes("/search/")) return responder(HTML_BUSCA);

    // Página de um episódio (declara o urlConfig) antes da página do título.
    if (/\/temporada-\d+\/episodio-\d+/.test(alvo)) {
      const slug = alvo.includes("matrix")
        ? "matrix-1-1999"
        : alvo.includes("duna")
          ? "duna-a-profecia"
          : "the-boys";
      const tipo = slug === "matrix-1-1999" ? "filmes" : "series";
      const t = Number(alvo.match(/temporada-(\d+)/)?.[1] || 1);
      const e = Number(alvo.match(/episodio-(\d+)/)?.[1] || 1);
      return responder(htmlEpisodio(slug, tipo, t, e));
    }

    // Página do título (lista as temporadas) — sempre com o botão, que é o que
    // distingue filme de série.
    if (alvo.endsWith("/series/matrix-1-1999")) return responder(HTML_FILME);
    if (alvo.endsWith("/series/duna-a-profecia")) {
      return responder(BOTAO_SERIE + HTML_SERIE_CURTA);
    }
    if (alvo.endsWith("/series/the-boys")) {
      return responder(BOTAO_SERIE + HTML_SERIE);
    }

    if (alvo.includes(".m3u8")) {
      return responder(playlistOk ? "#EXTM3U\n#EXTINF:10,\nseg.ts\n" : "<html>403</html>");
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
  resetMegacineSessions();
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
  assert.equal(session.title.slug, "the-boys");
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

test("a pesquisa não oferece filmes", async () => {
  stubFetch();
  const { getMegacineSession } = await import("../utils/megacineMenu.js");

  const replies = await abrir("the boys");
  const session = getMegacineSession("mgc-test@g.us", "5511999999999@lid");

  assert.deepEqual(
    session.candidates.map((c) => c.slug),
    ["the-boys", "duna-a-profecia"],
  );
  assert.ok(
    !replies.some((r) => r.includes("Matrix")),
    "o filme não aparece nas opções",
  );
});

test("um filme que escape à pesquisa é recusado na abertura", async () => {
  // Rede de segurança: a pesquisa filtra pelo meta, mas se o meta faltar o
  // título chega aqui — e a página ("Assistir Filme") é que decide.
  mock.method(globalThis, "fetch", async (url) => {
    const alvo = String(url);
    const responder = (corpo) => ({ ok: true, status: 200, text: async () => corpo });

    if (alvo.includes("/search/")) {
      return responder(
        `<article class="card"><a href="https://www.megacine.online/series/matrix-1-1999"><h3 class="card-title">Matrix</h3></a></article>`,
      );
    }
    if (alvo.endsWith("/series/matrix-1-1999")) return responder(HTML_FILME);
    return { ok: false, status: 404, text: async () => "404" };
  });

  const { handleMegacineReply, getMegacineSession } = await import(
    "../utils/megacineMenu.js"
  );

  const replies = [];
  const sendReply = async (t) => {
    replies.push(t);
  };

  await abrir("matrix");
  await handleMegacineReply({
    socket: fakeSocket,
    chatId: "mgc-test@g.us",
    senderLid: "5511999999999@lid",
    text: "mgc:an:0",
    sendReply,
  });

  assert.ok(
    replies.some((r) => r.includes("filme")),
    "o utilizador é avisado de que o título é um filme",
  );
  assert.ok(
    !replies.some((r) => r.includes("Baixando")),
    "o download não arranca",
  );
  assert.equal(getMegacineSession("mgc-test@g.us", "5511999999999@lid"), null);
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
    (_, i) =>
      `<a href="https://www.megacine.online/series/the-boys/temporada-01/episodio-${String(
        i + 1,
      ).padStart(2, "0")}"></a>`,
  ).join("");

  mock.method(globalThis, "fetch", async (url) => {
    const alvo = String(url);
    const responder = (corpo) => ({ ok: true, status: 200, text: async () => corpo });

    if (alvo.includes("/search/")) return responder(HTML_BUSCA);
    if (/\/temporada-\d+\/episodio-\d+/.test(alvo)) {
      return responder(htmlEpisodio("the-boys", "series", 1, 1));
    }
    if (alvo.endsWith("/series/the-boys")) {
      return responder(
        `<div class="episodes-modern-list episodes-modern-season-content active" data-season="1">${muitos}</div>`,
      );
    }
    return { ok: false, status: 404, text: async () => "404" };
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
  assert.ok(caption.includes("Megacine"), "traz a fonte");
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
