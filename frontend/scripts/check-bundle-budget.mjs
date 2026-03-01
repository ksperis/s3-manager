import fs from "node:fs";
import path from "node:path";

const DIST_DIR = path.resolve(process.cwd(), "dist");
const MANIFEST_PATH = path.join(DIST_DIR, ".vite", "manifest.json");
const MAX_ENTRY_JS_BYTES = 600 * 1024;
const MAX_TOTAL_JS_BYTES = 3_500 * 1024;
const MAX_LARGEST_CHUNK_BYTES = 1_500 * 1024;

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

function fail(message) {
  console.error(`[bundle-budget] ${message}`);
  process.exit(1);
}

if (!fs.existsSync(MANIFEST_PATH)) {
  fail(`Manifest not found at ${MANIFEST_PATH}. Ensure Vite manifest is enabled in build config.`);
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
const files = Object.values(manifest)
  .map((entry) => entry?.file)
  .filter((file) => typeof file === "string" && file.endsWith(".js"));

const uniqueFiles = Array.from(new Set(files));
if (uniqueFiles.length === 0) {
  fail("No JavaScript chunks found in Vite manifest.");
}

const stats = uniqueFiles.map((file) => {
  const absolute = path.join(DIST_DIR, file);
  const size = fs.statSync(absolute).size;
  return { file, size };
});

const entryChunkPath = Object.values(manifest).find((entry) => entry?.isEntry && typeof entry.file === "string")?.file;
if (!entryChunkPath) {
  fail("Unable to resolve entry chunk from manifest.");
}

const entryChunk = stats.find((item) => item.file === entryChunkPath);
if (!entryChunk) {
  fail(`Entry chunk ${entryChunkPath} is missing from the generated assets.`);
}

const totalJs = stats.reduce((sum, item) => sum + item.size, 0);
const largestChunk = [...stats].sort((a, b) => b.size - a.size)[0];

console.log(`[bundle-budget] Entry chunk: ${entryChunk.file} (${formatBytes(entryChunk.size)})`);
console.log(`[bundle-budget] Largest chunk: ${largestChunk.file} (${formatBytes(largestChunk.size)})`);
console.log(`[bundle-budget] Total JS: ${formatBytes(totalJs)} across ${stats.length} chunks`);

if (entryChunk.size > MAX_ENTRY_JS_BYTES) {
  fail(`Entry chunk exceeds budget (${formatBytes(entryChunk.size)} > ${formatBytes(MAX_ENTRY_JS_BYTES)}).`);
}
if (largestChunk.size > MAX_LARGEST_CHUNK_BYTES) {
  fail(`Largest chunk exceeds budget (${formatBytes(largestChunk.size)} > ${formatBytes(MAX_LARGEST_CHUNK_BYTES)}).`);
}
if (totalJs > MAX_TOTAL_JS_BYTES) {
  fail(`Total JS exceeds budget (${formatBytes(totalJs)} > ${formatBytes(MAX_TOTAL_JS_BYTES)}).`);
}

console.log("[bundle-budget] All budgets are within limits.");
