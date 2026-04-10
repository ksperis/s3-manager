import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const userDocsDir = path.join(repoRoot, "doc", "docs", "user");
const screenshotsDir = path.join(repoRoot, "doc", "docs", "assets", "screenshots", "user");
const readmePath = path.join(repoRoot, "README.md");
const ALLOWED_EXTRA_SCREENSHOTS = new Set();
const MULTI_SCREENSHOT_PAGE_RULES = new Map([
  ["screenshots-gallery.md", { min: 2 }],
]);

const markdownFiles = (await fs.readdir(userDocsDir)).filter((name) => name.endsWith(".md")).sort();
const errors = [];
const referencedScreenshots = new Set();

const stripFencedCodeBlocks = (content) => content.replace(/^```[\s\S]*?^```$/gm, "");

const extractThemedScreenshotReferences = (content) => {
  const blockMatches = [...content.matchAll(/<div[^>]+data-docs-themed-shot[^>]*>([\s\S]*?)<\/div>/g)];
  return blockMatches.map((match) => {
    const block = match[1];
    const variants = {};
    for (const variantMatch of block.matchAll(/<img[^>]+data-docs-shot-variant=["'](light|dark)["'][^>]+src=["']([^"']+\.png)["'][^>]*>/g)) {
      variants[variantMatch[1]] = {
        ref: variantMatch[2],
        fileName: path.basename(variantMatch[2]),
      };
    }
    return {
      light: variants.light ?? null,
      dark: variants.dark ?? null,
    };
  });
};

const extractLegacyScreenshotReferences = (content) => {
  const screenshotPattern = /(?:\.\.\/)+assets\/screenshots\/user\/([^"')\s]+\.png)/g;
  return [...content.matchAll(screenshotPattern)]
    .map((match) => match[1])
    .filter((name) => !name.endsWith(".light.png") && !name.endsWith(".dark.png"));
};

const extractReadmeScreenshotReferences = (content) => (
  [...content.matchAll(/<img[^>]+src=["'](doc\/docs\/assets\/screenshots\/user\/[^"']+\.png)["'][^>]*>/g)]
    .map((match) => match[1])
);

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
  const content = stripFencedCodeBlocks(await fs.readFile(filePath, "utf8"));
  const matches = extractThemedScreenshotReferences(content);
  const pageRule = MULTI_SCREENSHOT_PAGE_RULES.get(fileName);
  const legacyMatches = extractLegacyScreenshotReferences(content);

  if (legacyMatches.length > 0) {
    errors.push(`${fileName}: found legacy screenshot reference(s): ${legacyMatches.join(", ")}`);
  }

  if (pageRule?.min != null) {
    if (matches.length < pageRule.min) {
      errors.push(`${fileName}: expected at least ${pageRule.min} themed screenshot blocks, found ${matches.length}`);
      continue;
    }
  } else if (matches.length !== 1) {
    errors.push(`${fileName}: expected exactly 1 themed screenshot block, found ${matches.length}`);
    continue;
  }

  for (const [index, reference] of matches.entries()) {
    if (!reference.light || !reference.dark) {
      errors.push(`${fileName}: themed screenshot block ${index + 1} must include both light and dark variants`);
      continue;
    }

    const variants = [reference.light, reference.dark];
    const variantNames = variants.map((variant) => variant.fileName);
    const normalizedNames = variantNames.map((name) => name.replace(/\.(light|dark)\.png$/, ""));
    if (normalizedNames[0] !== normalizedNames[1]) {
      errors.push(`${fileName}: themed screenshot block ${index + 1} must use matching light/dark basenames`);
    }

    for (const variant of variants) {
      const imageName = variant.fileName;
      const resolvedPath = path.resolve(path.dirname(filePath), variant.ref);
      referencedScreenshots.add(imageName);

      if (path.normalize(resolvedPath) !== path.normalize(path.join(screenshotsDir, imageName))) {
        errors.push(`${fileName}: screenshot block ${index + 1} uses an invalid path for ${imageName}: ${variant.ref}`);
        continue;
      }

      try {
        await fs.access(resolvedPath);
      } catch {
        errors.push(`${fileName}: missing screenshot file ${imageName}`);
        continue;
      }

      try {
        const { width, height } = await pngSize(resolvedPath);
        if (width !== 1728 || height !== 972) {
          errors.push(`${fileName}: screenshot ${imageName} has ${width}x${height}, expected 1728x972`);
        }
      } catch (error) {
        errors.push(`${fileName}: unable to validate ${imageName} (${error instanceof Error ? error.message : String(error)})`);
      }
    }
  }
}

const readmeContent = await fs.readFile(readmePath, "utf8");
for (const ref of extractReadmeScreenshotReferences(readmeContent)) {
  const fileName = path.basename(ref);
  const resolvedPath = path.resolve(repoRoot, ref);
  referencedScreenshots.add(fileName);

  try {
    await fs.access(resolvedPath);
  } catch {
    errors.push(`README.md: missing screenshot file ${ref}`);
    continue;
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
