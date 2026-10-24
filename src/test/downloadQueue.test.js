import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { DOWNLOAD_CONCURRENCY } from "../config.js";
import {
  QueueTimeoutError,
  queuedDownloads,
  resetDownloadQueue,
  runningDownloads,
  withDownloadNotifier,
  withDownloadSlot,
} from "../services/downloadQueue.js";

const LIMITE = Math.max(1, DOWNLOAD_CONCURRENCY);

/** Promessa com controlo manual: permite segurar uma vaga até nós querermos. */
function deferred() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });

  return { promise, resolve };
}

/** Deixa as microtarefas pendentes correrem (a fila avança em promessas). */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  resetDownloadQueue();
});

test("fila: respeita o limite de downloads ao mesmo tempo", async () => {
  const vagas = Array.from({ length: LIMITE }, () => deferred());
  const iniciadas = [];

  const emCurso = vagas.map((vaga, i) =>
    withDownloadSlot(async () => {
      iniciadas.push(i);
      return vaga.promise;
    }),
  );

  await tick();
  assert.equal(runningDownloads(), LIMITE, "deve encher todas as vagas");
  assert.equal(queuedDownloads(), 0);

  // Mais dois pedidos: ficam à espera, sem arrancar.
  const extra = [deferred(), deferred()];
  const naFila = extra.map((vaga, i) =>
    withDownloadSlot(async () => {
      iniciadas.push(`extra-${i}`);
      return vaga.promise;
    }),
  );

  await tick();
  assert.equal(runningDownloads(), LIMITE, "o limite não pode ser excedido");
  assert.equal(queuedDownloads(), 2, "os excedentes esperam na fila");
  assert.ok(!iniciadas.includes("extra-0"), "o excedente não arranca antes da vez");

  // Liberta uma vaga: entra exatamente um da fila.
  vagas[0].resolve("ok");
  await tick();
  assert.equal(runningDownloads(), LIMITE);
  assert.equal(queuedDownloads(), 1);
  assert.ok(iniciadas.includes("extra-0"));

  // Liberta o resto para não deixar promessas pendentes.
  vagas[1]?.resolve("ok");
  await tick();
  extra[0].resolve("ok");
  extra[1].resolve("ok");
  await Promise.all([...emCurso, ...naFila]);
  assert.equal(runningDownloads(), 0);
});

test("fila: avisa a posição de quem espera e a vez de quem arranca", async () => {
  const vagas = Array.from({ length: LIMITE }, () => deferred());
  const emCurso = vagas.map((vaga) => withDownloadSlot(() => vaga.promise));
  await tick();

  const posicoes = [];
  const arranques = [];
  const vagaExtra = deferred();

  const naFila = withDownloadSlot(() => vagaExtra.promise, {
    onWait: (posicao) => posicoes.push(posicao),
    onStart: () => arranques.push("comecou"),
  });

  await tick();
  assert.deepEqual(posicoes, [1], "o primeiro da fila é o 1.º");
  assert.deepEqual(arranques, [], "ainda não arrancou");

  vagas[0].resolve("ok");
  await tick();
  assert.deepEqual(arranques, ["comecou"], "ao chegar a vez, arranca e avisa");

  vagaExtra.resolve("ok");
  // Liberta as vagas que ficaram ocupadas, senão a espera nunca termina.
  vagas.forEach((vaga) => vaga.resolve("ok"));
  await Promise.all([...emCurso, naFila]);
});

test("fila: o pedido prioritário passa à frente de quem esperava", async () => {
  const vagas = Array.from({ length: LIMITE }, () => deferred());
  const emCurso = vagas.map((vaga) => withDownloadSlot(() => vaga.promise));
  await tick();

  const ordem = [];
  const normal = deferred();
  const prioridade = deferred();

  const primeiro = withDownloadSlot(() => normal.promise, {
    onStart: () => ordem.push("normal"),
  });
  await tick();
  assert.equal(queuedDownloads(), 1);

  const segundo = withDownloadSlot(() => prioridade.promise, {
    priority: true,
    onStart: () => ordem.push("prioridade"),
  });
  await tick();
  assert.equal(queuedDownloads(), 2);

  // Abre uma vaga: quem entra é o prioritário, mesmo tendo chegado depois.
  vagas[0].resolve("ok");
  await tick();
  assert.deepEqual(ordem, ["prioridade"], "o dono não fica atrás dos membros");

  prioridade.resolve("ok");
  await tick();
  assert.deepEqual(ordem, ["prioridade", "normal"]);

  normal.resolve("ok");
  vagas[1]?.resolve("ok");
  await Promise.all([...emCurso, primeiro, segundo]);
});

test("fila: desiste com QueueTimeoutError quando a espera passa do limite", async () => {
  const vagas = Array.from({ length: LIMITE }, () => deferred());
  const emCurso = vagas.map((vaga) => withDownloadSlot(() => vaga.promise));
  await tick();

  const desistente = withDownloadSlot(async () => "nunca corre", { timeoutMs: 20 });

  await assert.rejects(desistente, QueueTimeoutError);
  assert.equal(queuedDownloads(), 0, "quem desiste sai da fila");

  vagas.forEach((vaga) => vaga.resolve("ok"));
  await Promise.all(emCurso);
});

test("fila: cada aviso vai para o chat de quem pediu", async () => {
  const chats = { x: [], a: [], b: [] };
  const vagas = Array.from({ length: LIMITE }, () => deferred());

  // As vagas são ocupadas por pedidos do chat X. Quando um deles termina, o
  // `pump` corre no contexto do X: se a fila lesse o contexto nesse momento em
  // vez de o capturar no pedido, o "chegou a sua vez" de outro usuário iria
  // parar ao chat X. É isso que este teste vigia.
  const emCurso = vagas.map((vaga) =>
    withDownloadNotifier(async (m) => chats.x.push(String(m)), () =>
      withDownloadSlot(() => vaga.promise),
    ),
  );
  await tick();

  // Os downloads do próprio X já avisaram a sua vez. A partir daqui, qualquer
  // aviso novo no chat X seria um aviso de outro usuário a chegar ao chat errado.
  const turnosDoXAntes = chats.x.filter((m) => /Chegou a sua vez/.test(m)).length;

  const vagaA = deferred();
  const vagaB = deferred();
  const pedidoA = withDownloadNotifier(async (m) => chats.a.push(String(m)), () =>
    withDownloadSlot(() => vagaA.promise),
  );
  const pedidoB = withDownloadNotifier(async (m) => chats.b.push(String(m)), () =>
    withDownloadSlot(() => vagaB.promise),
  );
  await tick();

  assert.match(chats.a.join("\n"), /fila/i, "A é avisado de que espera");
  assert.match(chats.b.join("\n"), /fila/i, "B é avisado de que espera");

  // Liberta uma vaga do X: entra o A, e só o A é avisado.
  vagas[0].resolve("ok");
  await tick();

  assert.match(chats.a.join("\n"), /Chegou a sua vez/, "A recebe o próprio aviso");
  assert.equal(
    chats.x.filter((m) => /Chegou a sua vez/.test(m)).length,
    turnosDoXAntes,
    "o chat X não pode receber o aviso de outro pedido",
  );

  // Liberta o A: entra o B, e o aviso vai para o B.
  vagaA.resolve("ok");
  await tick();

  assert.match(chats.b.join("\n"), /Chegou a sua vez/, "B recebe o próprio aviso");
  assert.equal(
    chats.x.filter((m) => /Chegou a sua vez/.test(m)).length,
    turnosDoXAntes,
    "o chat X continua sem avisos alheios",
  );
  assert.equal(
    chats.b.filter((m) => /Chegou a sua vez/.test(m)).length,
    1,
    "B recebe um único aviso de vez",
  );

  vagas.forEach((vaga) => vaga.resolve("ok"));
  vagaB.resolve("ok");
  await Promise.all([...emCurso, pedidoA, pedidoB]);
});
