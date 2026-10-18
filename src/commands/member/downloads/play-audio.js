import { PREFIX } from "../../../config.js";
import { InvalidParameterError } from "../../../errors/index.js";
import { downloadByCommand } from "../../../services/downloader.js";
import { downloadingMessage } from "../../../services/download-message.js";
import { startAudioFormatMenu } from "../../../utils/audioFormatMenu.js";
import fs from "node:fs/promises";

export default {
  name: "play-audio",
  description: "Faço o download de músicas",
  commands: ["play-audio", "play", "pa"],
  usage: `${PREFIX}play audio MC Hariel (ou link)`,
  /**
   * @param {import("../../../@types/index.d.ts").CommandHandleProps} props
   */
  handle: async ({
    socket,
    fullArgs,
    webMessage,
    remoteJid,
    userLid,
    sendSuccessReact,
    sendReply,
  }) => {
    if (!fullArgs.length) {
      throw new InvalidParameterError(
        "Você precisa informar o nome ou a URL da música!",
      );
    }

    let data;
    try {
      await sendReply(
        downloadingMessage({
          fileType: "áudio",
          usuario: webMessage?.pushName,
        }),
      );
      data = await downloadByCommand("play-audio", fullArgs);
      await sendSuccessReact();
    } catch (error) {
      if (data?.filePath) await fs.rm(data.filePath, { force: true }).catch(() => {});
      throw error;
    }

    // Link direto (quando o pedido já era uma URL, o match vem sem url).
    const url = data.url || fullArgs.match(/https?:\/\/\S+/)?.[0] || "";

    await startAudioFormatMenu({
      socket,
      chatId: remoteJid,
      ownerLid: userLid,
      ownerName: webMessage?.pushName,
      sendReply,
      payload: {
        filePath: data.filePath,
        fileName: data.fileName,
        title: data.title,
        artist: data.artist,
        duration: data.duration,
        platform: /youtube\.com|youtu\.be/i.test(url) ? "YouTube" : "Link direto",
        thumbnail: data.thumbnail,
        mimetype: data.mimetype,
      },
      url,
    });
  },
};