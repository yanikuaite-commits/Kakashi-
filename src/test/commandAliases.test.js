import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { DATABASE_DIR, OWNER_LID } from "../config.js";
import { addPrivateWhitelist, setBotEnabled } from "../utils/database.js";
import { dynamicCommand } from "../utils/dynamicCommand.js";
import { extractDataFromMessage, findCommandInMessage } from "../utils/index.js";

function extract(text, remoteJid = "aliases@g.us") {
  return extractDataFromMessage({ key: { remoteJid }, message: { conversation: text } });
}

test("comandos com espaços, acentos, hífen e sem prefixo preservam argumentos", async () => {
  for (const [text, name, args] of [
    [".play vídeo Minha  Música", "play-video", "Minha  Música"],
    ["play video Minha Música", "play-video", "Minha Música"],
    [".play-video Minha Música", "play-video", "Minha Música"],
    ["play audio Minha Música", "play-audio", "Minha Música"],
    [".play áudio Minha Música", "play-audio", "Minha Música"],
    ["yt MC Hariel", "yt-search", "MC Hariel"],
    [".anti link 1", "anti-link", "1"],
    ["bot on", "bot-state", ""],
    ["set spider api token exemplo", "set-spider-api-token", "exemplo"],
  ]) {
    const parsed = extract(text);
    const resolved = await findCommandInMessage(parsed.commandName, parsed.fullArgs);
    assert.equal(resolved.command?.name, name, text);
    assert.equal(resolved.fullArgs, args, text);
  }
  for (const text of ["yt-mp3 link", "yt-mp4 link", "conversa normal"]) {
    const parsed = extract(text);
    const resolved = await findCommandInMessage(parsed.commandName, parsed.fullArgs);
    assert.equal(resolved.command, null, text);
  }
});

test("menu sem prefixo navega normalmente; texto comum não responde", async () => {
  const sent = [];
  const warnings = [];
  const remoteJid = "owner@s.whatsapp.net";
  const send = async (text) => {
    const webMessage = { key: { remoteJid }, pushName: "Pessoa", message: { conversation: text } };
    await dynamicCommand({
      ...extractDataFromMessage(webMessage),
      userLid: OWNER_LID,
      webMessage,
      sendSuccessReact: async () => {},
      sendImageFromFile: async (image, caption) => sent.push({ image, caption }),
      sendWarningReply: async (message) => warnings.push(message),
    }, Date.now());
  };

  await send("menu download");
  await send(".menu download");
  await send("conversa normal");
  assert.equal(sent.length, 2);
  assert.match(sent[0].caption, /\.play video <nome ou link>/);
  assert.equal(sent[0].image, sent[1].image);
  assert.deepEqual(warnings, []);
});

test("comando restrito sem prefixo não contorna permissões no privado", async () => {
  const stateFile = path.join(DATABASE_DIR, "bot-state.json");
  const whitelistFile = path.join(DATABASE_DIR, "private-whitelist.json");
  const previousState = await readFile(stateFile);
  const previousWhitelist = await readFile(whitelistFile).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  const remoteJid = "aliases-permission@s.whatsapp.net";
  const errors = [];

  try {
    setBotEnabled(true);
    addPrivateWhitelist(remoteJid);
    for (const text of ["bot off", ".bot-off"]) {
      const webMessage = { key: { remoteJid }, message: { conversation: text } };
      await dynamicCommand({
        ...extractDataFromMessage(webMessage),
        userLid: "12345@lid",
        webMessage,
        sendErrorReply: async (message) => errors.push(message),
      }, Date.now());
    }
    assert.equal(errors.length, 2);
    assert.ok(errors.every((message) => /não tem permissão/.test(message)));
  } finally {
    await writeFile(stateFile, previousState);
    if (previousWhitelist === null) await rm(whitelistFile, { force: true });
    else await writeFile(whitelistFile, previousWhitelist);
  }
});
