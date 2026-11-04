import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import {
  ANIME_EPISODE_CREDITS,
  DAILY_FREE_CREDITS,
  DATABASE_DIR,
  DOWNLOAD_CREDIT_TIERS,
  OWNER_LID,
} from "../config.js";
import {
  accountBalance,
  accountMessage,
  addCredits,
  chargeCredits,
  chargeMediaCredits,
  commandCost,
  costsMessage,
  creditsExhaustedMessage,
  getAccount,
  mediaExtraCredits,
  minutesUntilDailyReset,
  mozambiqueClock,
  refundCredits,
  removeCredits,
  withCreditsContext,
} from "../services/credits.js";
import { downloadByCommand } from "../services/downloader.js";
import { activateGroup, setBotEnabled } from "../utils/database.js";
import { dynamicCommand } from "../utils/dynamicCommand.js";
import { extractDataFromMessage } from "../utils/index.js";

// 00h00 em Moçambique (UTC+2) equivale a 22h00 UTC do dia anterior.
const beforeMidnightInMozambique = Date.UTC(2026, 9, 14, 21, 59, 0);
const afterMidnightInMozambique = Date.UTC(2026, 9, 14, 22, 0, 0);
const middayInMozambique = Date.UTC(2026, 9, 14, 10, 0, 0); // 12h00 em Moçambique

// Cada execução usa contas próprias, para não herdar estado de execuções antigas.
const runId = randomUUID().slice(0, 8);
const testJid = (name) => `credits-${name}-${runId}@lid`;

/**
 * Executa um comando pelo dispatcher real com as funções de resposta espiadas.
 */
async function runCommand(jid, remoteJid, text) {
  const replies = [];
  const stickers = [];
  const images = [];
  const webMessage = {
    key: { remoteJid, participant: jid },
    pushName: "Teste",
    message: { conversation: text },
  };

  await dynamicCommand(
    {
      ...extractDataFromMessage(webMessage),
      userLid: jid,
      webMessage,
      sendReply: async (message) => replies.push(String(message)),
      sendWarningReply: async (message) => replies.push(String(message)),
      sendErrorReply: async (message) => replies.push(String(message)),
      sendSuccessReply: async (message) => replies.push(String(message)),
      sendWaitReply: async (message) => replies.push(String(message)),
      sendReact: async () => {},
      sendSuccessReact: async () => {},
      sendWaitReact: async () => {},
      sendStickerFromURL: async (file) => stickers.push(file),
      sendImageFromFile: async (file, caption) => images.push(String(caption ?? file)),
    },
    Date.now(),
  );

  return { replies, stickers, images, text: replies.concat(images).join("\n") };
}

const databaseFiles = [
  path.join(DATABASE_DIR, "credits.json"),
  path.join(DATABASE_DIR, "subscriptions.json"),
  path.join(DATABASE_DIR, "bot-state.json"),
  path.join(DATABASE_DIR, "inactive-groups.json"),
];

const previousDatabaseFiles = new Map();

before(async () => {
  for (const file of databaseFiles) {
    previousDatabaseFiles.set(
      file,
      await readFile(file).catch((error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      }),
    );
  }
});

// Devolve os arquivos exatamente como estavam antes (inclusive sem as contas de teste).
after(async () => {
  for (const [file, content] of previousDatabaseFiles) {
    if (content === null) {
      await rm(file, { force: true });
    } else {
      await writeFile(file, content);
    }
  }
});

test("custo por comando: tabela, isentos e padrão", () => {
  assert.equal(commandCost({ name: "tik-tok", commands: ["tik-tok", "ttk", "tik"] }), 4);
  assert.equal(commandCost({ name: "play-video", commands: ["play-video", "pv"] }), 5);
  assert.equal(commandCost({ name: "deepseek", commands: ["deepseek"] }), 6);
  assert.equal(
    commandCost({ name: "anime", commands: ["anime", "animes"] }),
    2,
    "a pesquisa de anime é barata; o gasto real é o episódio baixado",
  );
  assert.equal(commandCost({ name: "dado", commands: ["dado", "dice"] }), 5);
  assert.equal(commandCost({ name: "conta", commands: ["conta", "creditos"] }), 0);
  assert.equal(commandCost({ name: "menu", commands: ["menu", "help"] }), 0);
  assert.equal(commandCost({ name: "ping", commands: ["ping"] }), 0);
  // Comando isento não vira pago por causa de um atalho compartilhado.
  assert.equal(commandCost({ name: "suporte", commands: ["suporte", "help"] }), 0);
});

test("hierarquia dos downloads: do leve ao pesado, sem degraus invertidos", () => {
  const custo = (name) => commandCost({ name, commands: [name] });

  // A hierarquia é a garantia de que o preço diz algo: o áudio leve não pode
  // custar mais do que um vídeo, nem o vídeo de rede social mais do que o
  // YouTube (que ainda paga a pesquisa).
  assert.equal(custo("tik-tok-audio"), DOWNLOAD_CREDIT_TIERS.leve);
  assert.equal(custo("pinterest"), DOWNLOAD_CREDIT_TIERS.leve);
  assert.equal(custo("tik-tok"), DOWNLOAD_CREDIT_TIERS.medio);
  assert.equal(custo("instagram"), DOWNLOAD_CREDIT_TIERS.medio);
  assert.equal(custo("facebook"), DOWNLOAD_CREDIT_TIERS.medio);
  assert.equal(custo("x-twitter"), DOWNLOAD_CREDIT_TIERS.medio);
  assert.equal(custo("baixar"), DOWNLOAD_CREDIT_TIERS.medio);
  assert.equal(custo("play-video"), DOWNLOAD_CREDIT_TIERS.pesado);
  assert.equal(custo("play-audio"), DOWNLOAD_CREDIT_TIERS.pesado);

  assert.ok(
    DOWNLOAD_CREDIT_TIERS.leve < DOWNLOAD_CREDIT_TIERS.medio &&
      DOWNLOAD_CREDIT_TIERS.medio < DOWNLOAD_CREDIT_TIERS.pesado,
    "os degraus têm de subir",
  );

  // A âncora pedida: o download mais barato custa 3 créditos.
  assert.equal(DOWNLOAD_CREDIT_TIERS.leve, 3);
});

test("relógio de Moçambique e reset diário às 00h", () => {
  assert.deepEqual(mozambiqueClock(beforeMidnightInMozambique), {
    day: "2026-10-14",
    hour: 23,
    minute: 59,
  });
  assert.deepEqual(mozambiqueClock(afterMidnightInMozambique), {
    day: "2026-10-15",
    hour: 0,
    minute: 0,
  });
  assert.equal(minutesUntilDailyReset(beforeMidnightInMozambique), 1);
  assert.equal(minutesUntilDailyReset(afterMidnightInMozambique), 24 * 60);
});

test("créditos do dia resetam à meia-noite e os recarregados permanecem", () => {
  const jid = testJid("reset");

  const charge = chargeCredits(jid, 10, { now: middayInMozambique });
  assert.equal(charge.ok, true);
  assert.equal(charge.charged, 10);

  addCredits(jid, 5, { note: "pix", now: middayInMozambique });

  let account = getAccount(jid, middayInMozambique);
  assert.equal(account.dailyCredits, DAILY_FREE_CREDITS - 10);
  assert.equal(account.paidCredits, 5);
  assert.equal(accountBalance(account), DAILY_FREE_CREDITS - 5);

  // Ainda é o mesmo dia: nada é renovado.
  account = getAccount(jid, middayInMozambique + 60 * 1000);
  assert.equal(account.dailyCredits, DAILY_FREE_CREDITS - 10);

  // Passou das 00h00 em Moçambique: só os diários voltam.
  account = getAccount(jid, afterMidnightInMozambique);
  assert.equal(account.lastResetDay, "2026-10-15");
  assert.equal(account.dailyCredits, DAILY_FREE_CREDITS);
  assert.equal(account.paidCredits, 5);
  assert.equal(account.totalRecharged, 5);
  assert.equal(account.totalSpent, 10);
});

test("cobrança usa o diário primeiro, respeita o saldo e estorna o comando que falhou", () => {
  const jid = testJid("charge");

  // Usa o diário primeiro: 10 sai dos 30 gratuitos.
  const fromDaily = chargeCredits(jid, 10, { countUsage: true, now: middayInMozambique });
  assert.equal(fromDaily.ok, true);
  assert.equal(fromDaily.account.dailyCredits, DAILY_FREE_CREDITS - 10);
  assert.equal(fromDaily.account.paidCredits, 0);
  assert.equal(fromDaily.account.commandsUsed, 1);

  // Zera o diário e deixa 3 recarregados.
  chargeCredits(jid, DAILY_FREE_CREDITS - 10, { now: middayInMozambique });
  addCredits(jid, 3, { note: "pix", now: middayInMozambique });
  assert.equal(accountBalance(getAccount(jid, middayInMozambique)), 3);

  const fromPaid = chargeCredits(jid, 2, { now: middayInMozambique });
  assert.equal(fromPaid.ok, true);
  assert.equal(fromPaid.account.dailyCredits, 0);
  assert.equal(fromPaid.account.paidCredits, 1);

  // Sem saldo suficiente: não cobra nada e o diário não fica negativo.
  const insufficient = chargeCredits(jid, 5, { now: middayInMozambique });
  assert.equal(insufficient.ok, false);
  assert.equal(insufficient.charged, 0);
  assert.equal(accountBalance(insufficient.account), 1);

  // Mídia longa cobra o que sobrou (allowPartial).
  const partial = chargeCredits(jid, 5, { allowPartial: true, now: middayInMozambique });
  assert.equal(partial.ok, true);
  assert.equal(partial.charged, 1);
  assert.equal(accountBalance(getAccount(jid, middayInMozambique)), 0);

  const refunded = refundCredits(jid, 1, { now: middayInMozambique });
  assert.equal(accountBalance(refunded), 1);
});

test("créditos extras de mídia crescem com a duração e com o tamanho", () => {
  assert.equal(mediaExtraCredits({ seconds: 0 }), 0);
  assert.equal(mediaExtraCredits({ seconds: 179 }), 0);
  assert.equal(mediaExtraCredits({ seconds: 180 }), 2);
  assert.equal(mediaExtraCredits({ seconds: 599 }), 2);
  assert.equal(mediaExtraCredits({ seconds: 600 }), 4);
  assert.equal(mediaExtraCredits({ seconds: 1799 }), 4);
  assert.equal(mediaExtraCredits({ seconds: 1800 }), 6);

  assert.equal(mediaExtraCredits({ bytes: 5 * 1024 * 1024 }), 0);
  assert.equal(mediaExtraCredits({ bytes: 10 * 1024 * 1024 }), 2);
  assert.equal(mediaExtraCredits({ bytes: 30 * 1024 * 1024 }), 4);
  assert.equal(mediaExtraCredits({ bytes: 60 * 1024 * 1024 }), 6);

  // A duração tem prioridade sobre o tamanho quando a API informa as duas.
  assert.equal(mediaExtraCredits({ seconds: 700, bytes: 2 * 1024 * 1024 }), 4);
});

test("cobrança de mídia só acontece dentro do contexto do usuário", async () => {
  const jid = testJid("media");

  const outside = await chargeMediaCredits({ command: "vídeo", bytes: 40 * 1024 * 1024 });
  assert.equal(outside, 0);
  assert.equal(accountBalance(getAccount(jid)), DAILY_FREE_CREDITS);

  const inside = await withCreditsContext(jid, () =>
    chargeMediaCredits({ command: "vídeo", bytes: 40 * 1024 * 1024 }));
  assert.equal(inside, 4);
  assert.equal(accountBalance(getAccount(jid)), DAILY_FREE_CREDITS - 4);
});

test("mensagens de créditos explicam saldo, reset e recarga com o dono", () => {
  const account = getAccount(testJid("messages"), beforeMidnightInMozambique);
  const exhausted = creditsExhaustedMessage({
    commandName: "tik-tok",
    cost: 3,
    account,
    prefix: ".",
  });
  assert.match(exhausted, /créditos acabaram/i);
  assert.match(exhausted, /\.tik tok/);
  assert.match(exhausted, /00h00/);
  assert.match(exhausted, /dono/);
  assert.match(exhausted, /\.conta/);

  const message = accountMessage({
    account,
    name: "Ana",
    prefix: ".",
    now: beforeMidnightInMozambique,
  });
  assert.match(message, /MINHA CONTA/);
  assert.match(message, /Ana/);
  assert.match(
    message,
    new RegExp(`Saldo:\\* ${DAILY_FREE_CREDITS} créditos`),
  );
  assert.match(message, /Faltam: 1min/);
  assert.match(message, /\.conta custos/);

  const costs = costsMessage({ prefix: "." });
  assert.match(costs, /CUSTOS EM CRÉDITOS/);
  assert.match(costs, /\.tik tok — 4 créditos/);
  assert.match(costs, /acima de 30 min — \+6/);
  // O custo por episódio não vem da tabela de comandos: sem esta linha o
  // usuário veria `.anime — 2 créditos` e um episódio a custar 13.
  assert.match(costs, new RegExp(`${ANIME_EPISODE_CREDITS} créditos por episódio`));
});

test("dispatcher real cobra créditos, bloqueia sem saldo e não cobra o dono", async () => {
  const remoteJid = `credits-${runId}@g.us`;
  const memberJid = testJid("gate-member");
  const ownerJid = OWNER_LID;

  activateGroup(remoteJid);
  setBotEnabled(true);

  try {
    const run = (jid, text) => runCommand(jid, remoteJid, text);

    // Função de membro: roda e desconta o custo do comando.
    const charged = await run(memberJid, ".dado 3");
    assert.equal(charged.stickers.length, 1);
    assert.equal(
      accountBalance(getAccount(memberJid)),
      DAILY_FREE_CREDITS - commandCost({ name: "dado", commands: ["dado"] }),
    );

    // Zera o saldo: o comando não roda e o usuário é orientado a recarregar.
    const account = getAccount(memberJid);
    chargeCredits(memberJid, accountBalance(account));

    const blocked = await run(memberJid, ".dado 3");
    assert.equal(blocked.stickers.length, 0);
    assert.match(blocked.replies.join("\n"), /créditos acabaram/i);

    // Comando isento continua funcionando sem créditos.
    const free = await run(memberJid, ".conta");
    assert.match(free.replies.join("\n"), /MINHA CONTA/);
    assert.equal(accountBalance(getAccount(memberJid)), 0);

    // O dono não gasta créditos.
    const owner = await run(ownerJid, ".dado 3");
    assert.equal(owner.stickers.length, 1);
    assert.equal(getAccount(ownerJid).dailyCredits, DAILY_FREE_CREDITS);
    assert.ok(!owner.replies.join("\n").match(/créditos acabaram/i));
  } finally {
    // inactive-groups.json volta ao estado original no hook after().
    activateGroup(remoteJid);
  }
});

test("dono recarrega créditos e o usuário recarregado volta a usar", async () => {
  const remoteJid = `credits-recharge-${runId}@g.us`;
  const memberJid = "258841234567@lid";
  const mention = `@${memberJid.split("@")[0]}`;

  activateGroup(remoteJid);
  setBotEnabled(true);

  try {
    // Sem saldo: bloqueado.
    chargeCredits(memberJid, accountBalance(getAccount(memberJid)));
    const blocked = await runCommand(memberJid, remoteJid, ".dado 3");
    assert.equal(blocked.stickers.length, 0);
    assert.match(blocked.text, /créditos acabaram/i);

    // O comando lê valor e menção do fullArgs (args não separa por espaço).
    const ownerBefore = accountBalance(getAccount(OWNER_LID));
    const recharge = await runCommand(OWNER_LID, remoteJid, `.recarregar 50 ${mention}`);
    assert.match(recharge.text, /Recarga concluída/);
    assert.equal(accountBalance(getAccount(memberJid)), 50);
    assert.equal(getAccount(memberJid).paidCredits, 50);
    assert.equal(accountBalance(getAccount(OWNER_LID)), ownerBefore);

    // O usuário recarregado volta a usar: gasta o custo de .dado dos recarregados.
    const dadoCost = commandCost({ name: "dado", commands: ["dado", "dice"] });
    const afterRecharge = await runCommand(memberJid, remoteJid, ".dado 3");
    assert.equal(afterRecharge.stickers.length, 1);
    assert.equal(accountBalance(getAccount(memberJid)), 50 - dadoCost);
    assert.equal(getAccount(memberJid).paidCredits, 50 - dadoCost);

    // Recargas inválidas têm resposta clara e não mudam o saldo.
    const noUser = await runCommand(OWNER_LID, remoteJid, ".recarregar");
    assert.match(noUser.text, /Mencione o usuário/);
    const noAmount = await runCommand(OWNER_LID, remoteJid, `.recarregar ${mention}`);
    assert.match(noAmount.text, /quantos créditos/i);
    assert.equal(accountBalance(getAccount(memberJid)), 50 - dadoCost);

    // O dono consulta a conta de outro usuário.
    const ownerView = await runCommand(OWNER_LID, remoteJid, `.conta ${mention}`);
    assert.match(ownerView.text, /MINHA CONTA/);
    assert.match(ownerView.text, new RegExp(`Recarregados: ${50 - dadoCost}`));
  } finally {
    activateGroup(remoteJid);
  }
});

test("download real cobra créditos extras de mídia longa no contexto do usuário", async () => {
  const previousApiUrl = process.env.GENDOWNLOAD_API_URL;
  const body = Buffer.alloc(12 * 1024 * 1024);
  const requests = [];
  const createdFiles = [];

  const server = createServer((request, response) => {
    if (request.url === "/api/extract") {
      let raw = "";
      request.on("data", (chunk) => {
        raw += chunk;
      });
      request.on("end", () => {
        const input = JSON.parse(raw);
        requests.push(input);
        response.setHeader("Content-Type", "application/json");
        response.end(
          JSON.stringify({
            title: "Vídeo",
            author: "Canal",
            duration: input.url.endsWith("/longo") ? 700 : 0,
            formats: [
              {
                label: "720p",
                type: "video",
                ext: "mp4",
                url: `${baseUrl}/media`,
                filesize: body.length,
              },
            ],
          }),
        );
      });
      return;
    }

    response.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": body.length });
    response.end(body);
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  process.env.GENDOWNLOAD_API_URL = `${baseUrl}/api/extract`;

  const jid = testJid("download");

  try {
    // Zera os créditos do dia e deixa apenas 10 recarregados, para medir o extra.
    addCredits(jid, 10);
    chargeCredits(jid, getAccount(jid).dailyCredits);
    assert.equal(accountBalance(getAccount(jid)), 10);

    // Fora de um contexto de usuário (dono do bot) nada é cobrado.
    const ownerless = await downloadByCommand("tik-tok", `${baseUrl}/curto`);
    createdFiles.push(ownerless.filePath);
    assert.ok(ownerless.fileSize >= 12 * 1024 * 1024);
    assert.equal(accountBalance(getAccount(jid)), 10, "sem contexto não deve cobrar");

    // 12 MB (> 10 MB) e sem duração na API: +2 créditos.
    const sized = await withCreditsContext(jid, () =>
      downloadByCommand("tik-tok", `${baseUrl}/curto`));
    createdFiles.push(sized.filePath);
    assert.equal(accountBalance(getAccount(jid)), 8);

    // Duração informada (700s = 10 a 30 min) tem prioridade: +4 créditos.
    const long = await withCreditsContext(jid, () =>
      downloadByCommand("tik-tok", `${baseUrl}/longo`));
    createdFiles.push(long.filePath);
    assert.equal(long.duration, 700);
    assert.equal(accountBalance(getAccount(jid)), 4);

    assert.ok(requests.length >= 3, "a API de extração deve ter sido chamada");
    assert.equal(requests.at(-1).url, `${baseUrl}/longo`);
  } finally {
    for (const filePath of createdFiles) {
      if (filePath) await rm(filePath, { force: true });
    }
    if (previousApiUrl === undefined) delete process.env.GENDOWNLOAD_API_URL;
    else process.env.GENDOWNLOAD_API_URL = previousApiUrl;
    server.close();
    await once(server, "close");
  }
});

test("remoção gasta o diário primeiro e chega aos recarregados", () => {
  const jid = testJid("remove");
  const pago = 10;
  const pequeno = 5; // dentro do diário

  // Saldo: o diário + 10 recarregados.
  addCredits(jid, pago, { note: "pix", now: middayInMozambique });

  const parcial = removeCredits(jid, pequeno, { note: "punição", now: middayInMozambique });
  assert.equal(parcial.ok, true);
  assert.equal(parcial.removed, pequeno);
  assert.equal(getAccount(jid, middayInMozambique).dailyCredits, DAILY_FREE_CREDITS - pequeno);
  assert.equal(
    getAccount(jid, middayInMozambique).paidCredits,
    pago,
    "dentro do diário, os recarregados ficam intactos",
  );

  // Mais do que o saldo total: estrito, não remove nada.
  const saldo = accountBalance(getAccount(jid, middayInMozambique));
  const exagerado = removeCredits(jid, saldo + 1, { now: middayInMozambique });
  assert.equal(exagerado.ok, false);
  assert.equal(exagerado.reason, "saldo insuficiente");
  assert.equal(exagerado.removed, 0);
  assert.equal(accountBalance(getAccount(jid, middayInMozambique)), saldo);

  // Remover mais do que resta no diário passa a tocar nos recarregados.
  const restanteDiario = getAccount(jid, middayInMozambique).dailyCredits;
  const fundo = removeCredits(jid, restanteDiario + 3, { now: middayInMozambique });
  assert.equal(fundo.removed, restanteDiario + 3);
  assert.equal(getAccount(jid, middayInMozambique).dailyCredits, 0);
  assert.equal(getAccount(jid, middayInMozambique).paidCredits, pago - 3);

  // O registo fica na conta (mais recente primeiro), para uma reclamação de
  // "os meus créditos desapareceram" ter resposta.
  const registos = getAccount(jid, middayInMozambique).adjustments;
  assert.equal(registos[0].removed, restanteDiario + 3);
  assert.equal(registos[1].removed, pequeno);
  assert.equal(registos[1].note, "punição");
});

test("remoção parcial esvazia o que resta sem falhar", () => {
  const jid = testJid("remove-tudo");

  addCredits(jid, 7, { now: middayInMozambique });
  const saldo = accountBalance(getAccount(jid, middayInMozambique));

  const tudo = removeCredits(jid, saldo + 100, {
    allowPartial: true,
    now: middayInMozambique,
  });

  assert.equal(tudo.ok, true);
  assert.equal(tudo.removed, saldo, "remove exatamente o que existia");
  assert.equal(accountBalance(getAccount(jid, middayInMozambique)), 0);
});

test("remoção com valor inválido não mexe no saldo", () => {
  const jid = testJid("remove-invalido");

  const antes = accountBalance(getAccount(jid, middayInMozambique));
  const zero = removeCredits(jid, 0, { now: middayInMozambique });

  assert.equal(zero.ok, false);
  assert.equal(zero.reason, "valor inválido");
  assert.equal(accountBalance(getAccount(jid, middayInMozambique)), antes);
});

test("o diário removido volta no reset das 00h00 e os recarregados não", () => {
  const jid = testJid("remove-reset");
  const pago = 20;

  addCredits(jid, pago, { note: "pix", now: middayInMozambique });
  // Remove o diário inteiro e ainda toca nos recarregados.
  const resultado = removeCredits(jid, DAILY_FREE_CREDITS + pago, {
    now: middayInMozambique,
  });

  assert.equal(resultado.removed, DAILY_FREE_CREDITS + pago);
  assert.equal(accountBalance(getAccount(jid, middayInMozambique)), 0);

  // Passou a meia-noite: os diários renovam, os recarregados ficaram a zero.
  const depois = getAccount(jid, afterMidnightInMozambique);
  assert.equal(depois.dailyCredits, DAILY_FREE_CREDITS);
  assert.equal(depois.paidCredits, 0);
});

test("dono remove créditos pelo comando e o usuário fica sem saldo", async () => {
  const remoteJid = `credits-remove-${runId}@g.us`;
  const memberJid = "258841119999@lid";
  const mention = `@${memberJid.split("@")[0]}`;

  activateGroup(remoteJid);
  setBotEnabled(true);

  try {
    addCredits(memberJid, 40, { note: "pix" });
    const antes = accountBalance(getAccount(memberJid));
    assert.equal(antes, DAILY_FREE_CREDITS + 40);

    // Remover dentro do diário: o saldo sai do diário, os recarregados ficam.
    const remocao = await runCommand(
      OWNER_LID,
      remoteJid,
      `.remover-creditos 5 ${mention}`,
    );
    assert.match(remocao.text, /Créditos removidos/);
    assert.equal(accountBalance(getAccount(memberJid)), antes - 5);

    // O saldo removido do diário não pode reaparecer como recarregado.
    assert.equal(getAccount(memberJid).dailyCredits, DAILY_FREE_CREDITS - 5);
    assert.equal(getAccount(memberJid).paidCredits, 40);

    // "tudo" esvazia a conta.
    const tudo = await runCommand(OWNER_LID, remoteJid, `.remover-creditos tudo ${mention}`);
    assert.match(tudo.text, /Créditos removidos/);
    assert.equal(accountBalance(getAccount(memberJid)), 0);

    // "tudo" numa conta já vazia diz isso, em vez do genérico "valor inválido".
    const vazio = await runCommand(OWNER_LID, remoteJid, `.remover-creditos tudo ${mention}`);
    assert.match(vazio.text, /já está sem créditos/i);

    // O usuário sem saldo fica bloqueado.
    const blocked = await runCommand(memberJid, remoteJid, ".dado 3");
    assert.match(blocked.text, /créditos acabaram/i);

    // Pedidos inválidos têm resposta clara e não mexem no saldo.
    const noUser = await runCommand(OWNER_LID, remoteJid, ".remover-creditos 10");
    assert.match(noUser.text, /Mencione o usuário/);

    const noAmount = await runCommand(OWNER_LID, remoteJid, `.remover-creditos ${mention}`);
    assert.match(noAmount.text, /quantos créditos/i);

    // Pedir mais do que existe não zera a conta em silêncio.
    addCredits(memberJid, 5, { note: "pix" });
    const exagerado = await runCommand(
      OWNER_LID,
      remoteJid,
      `.remover-creditos 999 ${mention}`,
    );
    assert.match(exagerado.text, /saldo insuficiente/i);
    assert.equal(accountBalance(getAccount(memberJid)), 5);

    // O dono não tem saldo para remover de si próprio.
    const dono = await runCommand(
      OWNER_LID,
      remoteJid,
      `.remover-creditos 10 @${OWNER_LID.split("@")[0]}`,
    );
    assert.match(dono.text, /não tem saldo/i);

    // Um membro comum não pode usar o comando: sem esta barreira, qualquer um
    // esvaziaria a conta de outro.
    addCredits(memberJid, 30, { note: "pix" });
    const saldoMembro = accountBalance(getAccount(memberJid));
    const invasor = await runCommand(
      memberJid,
      remoteJid,
      `.remover-creditos 30 @${OWNER_LID.split("@")[0]}`,
    );
    assert.match(invasor.text, /não tem permissão/i);
    assert.equal(accountBalance(getAccount(memberJid)), saldoMembro);
  } finally {
    activateGroup(remoteJid);
  }
});
