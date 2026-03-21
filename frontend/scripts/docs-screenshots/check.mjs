import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const userDocsDir = path.join(repoRoot, "doc", "docs", "user");
const screenshotsDir = path.join(repoRoot, "doc", "docs", "assets", "screenshots", "user");
const ALLOWED_EXTRA_SCREENSHOTS = new Set(["workspace-portal.png"]);

const markdownFiles = (await fs.readdir(userDocsDir)).filter((name) => name.endsWith(".md")).sort();
const errors = [];
const referencedScreenshots = new Set();

const pngSize = async (filePath) => {
  const buffer = await fs.readFile(filePath);
  const signature = buffer.subarray(0, 8);
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!signature.equals(pngSignature)) {
    throw new Error(`Not a PNG file: ${filePath}`);
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return { width, height };
};

for (const fileName of markdownFiles) {
  const filePath = path.join(userDocsDir, fileName);
  const content = await fs.readFile(filePath, "utf8");
  const matches = [...content.matchAll(/!\[[^\]]*\]\(\.\.\/assets\/screenshots\/user\/([^)]+\.png)\)/g)];

  if (matches.length !== 1) {
    errors.push(`${fileName}: expected exactly 1 screenshot reference, found ${matches.length}`);
    continue;
  }

  const imageName = matches[0][1];
  referencedScreenshots.add(imageName);
  const imagePath = path.join(screenshotsDir, imageName);

  try {
    await fs.access(imagePath);
  } catch {
    errors.push(`${fileName}: missing screenshot file ${imageName}`);
    continue;
  }

  try {
    const { width, height } = await pngSize(imagePath);
    if (width !== 1728 || height !== 972) {
      errors.push(`${fileName}: screenshot ${imageName} has ${width}x${height}, expected 1728x972`);
    }
  } catch (error) {
    errors.push(`${fileName}: unable to validate ${imageName} (${error instanceof Error ? error.message : String(error)})`);
  }
}

const screenshotFiles = new Set((await fs.readdir(screenshotsDir)).filter((name) => name.endsWith(".png")));
const unexpectedScreenshots = [...screenshotFiles]
  .filter((name) => !referencedScreenshots.has(name) && !ALLOWED_EXTRA_SCREENSHOTS.has(name))
  .sort();
if (unexpectedScreenshots.length > 0) {
  errors.push(`unexpected screenshot file(s): ${unexpectedScreenshots.join(", ")}`);
}

if (errors.length > 0) {
  console.error("Documentation screenshot check failed:\n");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`Screenshot check passed for ${markdownFiles.length} user page(s).`);
