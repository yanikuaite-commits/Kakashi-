import fs from "node:fs/promises";
import path from "node:path";
import { Jimp } from "jimp";
import { TEMP_DIR } from "../config.js";

export async function transformImage(inputPath, operation) {
  const image = await Jimp.read(inputPath);
  if (operation === "invert") image.invert();
  if (operation === "grayscale") image.greyscale();
  if (operation === "blur") image.blur(8);
  if (operation === "pixelate") image.pixelate(12);
  await fs.mkdir(TEMP_DIR, { recursive: true });
  const outputPath = path.join(TEMP_DIR, `jimp-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
  await image.write(outputPath);
  return outputPath;
}

export async function removeBackground(inputPath) {
  const image = await Jimp.read(inputPath);
  image.scan((x, y, idx) => {
    const red = image.bitmap.data[idx];
    const green = image.bitmap.data[idx + 1];
    const blue = image.bitmap.data[idx + 2];
    if (red > 235 && green > 235 && blue > 235) image.bitmap.data[idx + 3] = 0;
  });
  await fs.mkdir(TEMP_DIR, { recursive: true });
  const outputPath = path.join(TEMP_DIR, `rmbg-${Date.now()}.png`);
  await image.write(outputPath);
  return outputPath;
}