import ffmpeg from "fluent-ffmpeg";
import path from "node:path";
import { TEMP_DIR } from "../config.js";

function convert(input, extension, configure) {
  return new Promise((resolve, reject) => {
    const output = path.join(TEMP_DIR, `convert-${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`);
    configure(ffmpeg(input)).output(output).on("end", () => resolve(output)).on("error", reject).run();
  });
}

export const toGif = (input) => convert(input, "gif", (command) => command.videoFilters("fps=10,scale=480:-1:flags=lanczos"));
export const toMp3 = (input) => convert(input, "mp3", (command) => command.noVideo().audioBitrate("192k"));
export const toImage = (input) => convert(input, "jpg", (command) => command.frames(1));