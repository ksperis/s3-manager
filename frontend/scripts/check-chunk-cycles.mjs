import fs from "node:fs";
import path from "node:path";

const DIST_DIR = path.resolve(process.cwd(), "dist");
const MANIFEST_PATH = path.join(DIST_DIR, ".vite", "manifest.json");

function fail(message) {
  console.error(`[chunk-cycle] ${message}`);
  process.exit(1);
}

if (!fs.existsSync(MANIFEST_PATH)) {
  fail(`Manifest not found at ${MANIFEST_PATH}. Run 'npm run build' first.`);
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
const jsFiles = Array.from(
  new Set(
    Object.values(manifest)
      .map((entry) => entry?.file)
      .filter((file) => typeof file === "string" && file.endsWith(".js"))
  )
);

if (jsFiles.length === 0) {
  fail("No JavaScript chunks found in manifest.");
}

const baseNameSet = new Set(jsFiles.map((file) => path.basename(file)));
const graph = new Map();
for (const file of jsFiles) {
  const basename = path.basename(file);
  const source = fs.readFileSync(path.join(DIST_DIR, file), "utf8");
  const deps = new Set();
  const fromPattern = /from["']\.\/([^"']+\.js)["']/g;
  const sideEffectPattern = /import["']\.\/([^"']+\.js)["']/g;

  for (const match of source.matchAll(fromPattern)) {
    if (baseNameSet.has(match[1])) deps.add(match[1]);
  }
  for (const match of source.matchAll(sideEffectPattern)) {
    if (baseNameSet.has(match[1])) deps.add(match[1]);
  }

  graph.set(basename, [...deps]);
}

const indexByNode = new Map();
const lowlinkByNode = new Map();
const onStack = new Set();
const stack = [];
let index = 0;
const stronglyConnectedComponents = [];

function strongConnect(node) {
  indexByNode.set(node, index);
  lowlinkByNode.set(node, index);
  index += 1;
  stack.push(node);
  onStack.add(node);

  const neighbors = graph.get(node) ?? [];
  for (const neighbor of neighbors) {
    if (!graph.has(neighbor)) continue;
    if (!indexByNode.has(neighbor)) {
      strongConnect(neighbor);
      lowlinkByNode.set(node, Math.min(lowlinkByNode.get(node), lowlinkByNode.get(neighbor)));
    } else if (onStack.has(neighbor)) {
      lowlinkByNode.set(node, Math.min(lowlinkByNode.get(node), indexByNode.get(neighbor)));
    }
  }

  if (lowlinkByNode.get(node) === indexByNode.get(node)) {
    const component = [];
    while (stack.length > 0) {
      const current = stack.pop();
      onStack.delete(current);
      component.push(current);
      if (current === node) break;
    }
    stronglyConnectedComponents.push(component);
  }
}

for (const node of graph.keys()) {
  if (!indexByNode.has(node)) {
    strongConnect(node);
  }
}

const cyclicComponents = stronglyConnectedComponents.filter((component) => {
  if (component.length > 1) return true;
  const only = component[0];
  return (graph.get(only) ?? []).includes(only);
});

if (cyclicComponents.length > 0) {
  const formatted = cyclicComponents
    .map((component) => component.sort().join(" -> "))
    .join(" | ");
  fail(`Detected static chunk import cycle(s): ${formatted}`);
}

console.log(`[chunk-cycle] No static chunk import cycle detected across ${jsFiles.length} chunks.`);
