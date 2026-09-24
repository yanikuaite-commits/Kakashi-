import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { ASSETS_DIR } from "../config.js";
import { MENU_CATEGORIES, menuMessage } from "../menu.js";
import command from "../commands/member/menu.js";
import { formatCommand, readCommandImports } from "../utils/index.js";

const chatId = "menu-test@g.us";

test("menu principal mostra navegação curta e pesquisa fica nos downloads", () => {
  const main = menuMessage(chatId, "", "Pessoa *legal*");
  assert.match(main, /Usuário: Pessoa legal/);
  assert.match(main, /\.menu download/);
  assert.doesNotMatch(main, /\.yt-mp4/);
  assert.match(menuMessage(chatId, "download"), /\.yt <termo>/);
  assert.match(menuMessage(chatId, "downloads"), /\.play audio <nome ou link>/);
  assert.match(menuMessage(chatId, "download"), /\.play video <nome ou link>/);
  assert.match(menuMessage(chatId, "cgeral"), /\.ping/);
  assert.match(menuMessage(chatId, "Proteção"), /\.anti call <1\/0>/);
  assert.equal(menuMessage(chatId, "desconhecido"), null);
});

test("todos os submenus mantêm a mesma foto e uma legenda utilizável", async () => {
  const sent = [];
  const imagePath = path.join(ASSETS_DIR, "images", "takeshi-bot.png");
  for (const section of ["", ...MENU_CATEGORIES.map(({ key }) => key)]) {
    await command.handle({
      remoteJid: chatId,
      fullArgs: section,
      webMessage: { pushName: "Pessoa" },
      sendSuccessReact: async () => {},
      sendImageFromFile: async (file, caption) => sent.push({ file, caption }),
    });
  }
  assert.equal(sent.length, MENU_CATEGORIES.length + 1);
  for (const { file, caption } of sent) {
    assert.equal(file, imagePath);
    assert.ok(caption.length <= 1024, `Legenda longa: ${caption.length} caracteres`);
    assert.doesNotMatch(caption, /\.[a-z0-9]+-[a-z0-9]+/i);
  }
  await assert.rejects(
    command.handle({ remoteJid: chatId, fullArgs: "inexistente" }),
    /Categoria desconhecida/,
  );
});

test("cada comando apresentado no menu pode ser resolvido pelo bot", async () => {
  const imports = await readCommandImports();
  const available = new Set(Object.values(imports)
    .flat()
    .flatMap(({ commands = [] }) => commands.map(formatCommand)));
  for (const category of MENU_CATEGORIES) {
    for (const [usage] of category.commands) {
      const name = usage.split(" ")[0];
      assert.ok(available.has(formatCommand(name)), `${category.key}: ${name} não existe`);
    }
  }
});
