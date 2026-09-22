import fs from "node:fs/promises";
import path from "node:path";
import { createCanvas } from "canvas";
import { TEMP_DIR } from "../config.js";

export async function generateTtp(text) {
  const value = String(text || "").trim();
  if (!value) throw new Error("Você precisa informar o texto da imagem.");
  const lines = value.match(/.{1,24}(?:\s+|$)/g)?.map((line) => line.trim()) || [value];
  const canvas = createCanvas(800, Math.max(300, 180 + lines.length * 58));
  const context = canvas.getContext("2d");
  context.fillStyle = "#176b87";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#ffffff";
  context.font = "bold 42px Sans";
  context.textAlign = "center";
  context.textBaseline = "middle";
  lines.forEach((line, index) => context.fillText(line, 400, canvas.height / 2 + (index - (lines.length - 1) / 2) * 58));
  await fs.mkdir(TEMP_DIR, { recursive: true });
  const filePath = path.join(TEMP_DIR, `ttp-${Date.now()}.png`);
  await fs.writeFile(filePath, canvas.toBuffer("image/png"));
  return filePath;
}