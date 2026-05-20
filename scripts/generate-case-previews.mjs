import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const sourceDatasetPath = new URL("../public/cases.json", import.meta.url);
const localImageRoot = process.env.CASE_LIBRARY_IMAGE_ROOT ?? "C:/Users/Tikki/AppData/Local/Temp/awesome-gpt-image-2-codex/data/images";
const remoteImageRoot = "https://raw.githubusercontent.com/CTctikki/awesome-gpt-image-2/main/data/images";
const outputRoot = new URL("../public/case-previews/", import.meta.url);

mkdirSync(outputRoot, { recursive: true });

const sourceDataset = JSON.parse(readFileSync(sourceDatasetPath, "utf8"));
const uniqueImages = [...new Set(sourceDataset.cases.map((caseItem) => caseItem.image))];

function resolveLocalImagePath(imagePath) {
  const fileName = imagePath.split("/").at(-1);
  if (!fileName) {
    return null;
  }

  const absolutePath = path.join(localImageRoot, fileName);
  return existsSync(absolutePath) ? absolutePath : null;
}

async function readImageBytes(imagePath) {
  const localPath = resolveLocalImagePath(imagePath);
  if (localPath) {
    return readFile(localPath);
  }

  const response = await fetch(`${remoteImageRoot}/${imagePath.split("/").at(-1)}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch source image: ${imagePath}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

async function generatePreview(imagePath) {
  const fileName = imagePath.split("/").at(-1);
  if (!fileName) {
    return;
  }

  const stem = fileName.replace(/\.(jpg|jpeg|png|webp)$/i, "");
  const outputPath = new URL(`./${stem}.webp`, outputRoot);
  if (existsSync(outputPath)) {
    return;
  }

  const input = await readImageBytes(imagePath);
  const preview = await sharp(input)
    .rotate()
    .resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 72 })
    .toBuffer();

  await writeFile(outputPath, preview);
}

async function main() {
  for (const imagePath of uniqueImages) {
    await generatePreview(imagePath);
  }

  console.log(`Generated ${uniqueImages.length} case preview images.`);
}

await main();
