import { PREFIX } from "../../../config.js";
import { InvalidParameterError } from "../../../errors/index.js";
import { downloadByCommand, setPendingDocOffer } from "../../../services/downloader.js";
import { downloadingMessage } from "../../../services/download-message.js";
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
    sendAudioDocumentFromFile,
    sendAudioFromFile,
    fullArgs,
    remoteJid,
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
      await sendReply(downloadingMessage({ fileType: "áudio" }));
      data = await downloadByCommand("play-audio", fullArgs);
      await sendSuccessReact();
      await sendAudioFromFile(data.filePath, false, true);
    } catch (error) {
      if (data?.filePath) await fs.rm(data.filePath, { force: true }).catch(() => {});
      throw error;
    }

    setPendingDocOffer(remoteJid, {
      filePath: data.filePath,
      fileName: data.fileName,
      title: data.title,
      artist: data.artist,
      thumbnail: data.thumbnail,
      mimetype: data.mimetype,
    });

    await sendReply(
      "Quer que eu mande essa música também como *documento MP3*?\n\n1. ✅ Sim, manda como documento\n2. ❌ Não precisa\n\nResponda com o número 👇",
    );
  },
};
