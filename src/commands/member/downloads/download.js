import { PREFIX } from "../../../config.js";
import { handleDownload } from "../../download.js";

export default {
  name: "baixar",
  description: "Baixo vídeos de links compatíveis com GenDownload",
  commands: ["baixar", "download"],
  usage: `${PREFIX}baixar https://www.youtube.com/watch?v=...`,
  handle: async ({ socket, webMessage, fullArgs }) => {
    await handleDownload(socket, webMessage, fullArgs.trim().split(/\s+/).filter(Boolean));
  },
};
