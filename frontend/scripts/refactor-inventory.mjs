import fs from "node:fs";
import path from "node:path";

const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".css", ".scss", ".mjs"]);
const EXCLUDED_DIRS = new Set([
  ".playwright-cli",
  "coverage",
  "dist",
  "node_modules",
  "output",
  "playwright-report",
  "test-results",
]);
const SIGNALS = [
  ["localStorage", "localStorage"],
  ["sessionStorage", "sessionStorage"],
  ["catch", "catch ("],
  ["error.message", "error.message"],
  ["String(error)", "String(error)"],
  ["console.", "console."],
  ["dangerouslySetInnerHTML", "dangerouslySetInnerHTML"],
  ["innerHTML", "innerHTML"],
  ["TODO", "TODO"],
  ["FIXME", "FIXME"],
];

function resolveFrontendRoot() {
  const cwd = process.cwd();
  if (fs.existsSync(path.join(cwd, "src")) && fs.existsSync(path.join(cwd, "package.json"))) {
    return cwd;
  }
  const nested = path.join(cwd, "frontend");
  if (fs.existsSync(path.join(nested, "src")) && fs.existsSync(path.join(nested, "package.json"))) {
    return nested;
  }
  throw new Error("Unable to find frontend root. Run from the repository root or frontend/.");
}

function walkFiles(dir, output = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name)) {
        walkFiles(path.join(dir, entry.name), output);
      }
      continue;
    }
    if (entry.isFile()) {
      output.push(path.join(dir, entry.name));
    }
  }
  return output;
}

function countLines(file) {
  const text = fs.readFileSync(file, "utf8");
  if (text.length === 0) return 0;
  return text.split(/\r\n|\r|\n/).length;
}

function relative(root, file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function codeFilesUnder(root) {
  return walkFiles(root).filter((file) => CODE_EXTENSIONS.has(path.extname(file)));
}

function byTopLevel(root, files, depth) {
  const totals = new Map();
  for (const file of files) {
    const rel = relative(root, file);
    const parts = rel.split("/");
    const key = parts.slice(0, Math.min(depth, parts.length)).join("/");
    totals.set(key, (totals.get(key) ?? 0) + countLines(file));
  }
  return [...totals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function signalCounts(files) {
  const inventoryScript = path.join(resolveFrontendRoot(), "scripts", "refactor-inventory.mjs");
  const scannedFiles = files.filter((file) => file !== inventoryScript);
  return SIGNALS.map(([label, pattern]) => {
    let occurrences = 0;
    const touchedFiles = new Set();
    for (const file of scannedFiles) {
      const text = fs.readFileSync(file, "utf8");
      const count = text.split(pattern).length - 1;
      if (count > 0) {
        occurrences += count;
        touchedFiles.add(file);
      }
    }
    return { label, occurrences, files: touchedFiles.size };
  });
}

function routeRows(frontendRoot) {
  const routerPath = path.join(frontendRoot, "src", "router.tsx");
  if (!fs.existsSync(routerPath)) return [];

  const lines = fs.readFileSync(routerPath, "utf8").split(/\r\n|\r|\n/);
  const rows = [];
  let currentSurface = "shared";

  function surfaceFromPath(pathValue) {
    return (
      pathValue.startsWith("/admin") || pathValue.startsWith("admin")
        ? "admin"
        : pathValue.startsWith("/manager") || pathValue.startsWith("manager")
          ? "manager"
          : pathValue.startsWith("/portal") || pathValue.startsWith("portal")
            ? "portal"
            : pathValue.startsWith("/browser") || pathValue.startsWith("browser")
              ? "browser"
              : pathValue.startsWith("/ceph-admin") || pathValue.startsWith("ceph-admin")
                ? "ceph-admin"
                : pathValue.startsWith("/storage-ops") || pathValue.startsWith("storage-ops")
                ? "storage-ops"
                : "shared"
    );
  }

  for (const line of lines) {
    if (!line.includes("<Route")) continue;
    const pathValue = /\bpath="([^"]+)"/.exec(line)?.[1];
    if (!pathValue) continue;
    if (pathValue.startsWith("/")) {
      currentSurface = surfaceFromPath(pathValue);
    }
    const surface = pathValue.startsWith("/") ? surfaceFromPath(pathValue) : currentSurface;
    const element = /\belement=\{<([A-Za-z0-9_]+)/.exec(line)?.[1] ?? "";
    rows.push({ path: pathValue, surface, element: element ?? "" });
  }
  return rows;
}

function printList(title, rows, formatter, limit = rows.length) {
  console.log(`\n## ${title}`);
  for (const row of rows.slice(0, limit)) {
    console.log(`- ${formatter(row)}`);
  }
}

const frontendRoot = resolveFrontendRoot();
const srcRoot = path.join(frontendRoot, "src");
const frontendFiles = codeFilesUnder(frontendRoot);
const srcFiles = codeFilesUnder(srcRoot);
const largest = frontendFiles
  .map((file) => ({ file: relative(frontendRoot, file), lines: countLines(file) }))
  .sort((a, b) => b.lines - a.lines || a.file.localeCompare(b.file));
const srcAreaTotals = byTopLevel(srcRoot, srcFiles, 2);
const topLevelTotals = byTopLevel(frontendRoot, frontendFiles, 1);
const routes = routeRows(frontendRoot);
const routeSurfaceTotals = routes.reduce((acc, route) => {
  acc.set(route.surface, (acc.get(route.surface) ?? 0) + 1);
  return acc;
}, new Map());

console.log("# Frontend Refactor Inventory");
console.log(`Generated from: ${frontendRoot}`);
console.log(`Frontend code files: ${frontendFiles.length}`);
console.log(`Frontend code lines: ${largest.reduce((sum, item) => sum + item.lines, 0)}`);
console.log(`Source code files: ${srcFiles.length}`);
console.log(`Source code lines: ${srcFiles.reduce((sum, file) => sum + countLines(file), 0)}`);

printList("Largest Top-Level Areas", topLevelTotals, ([area, lines]) => `${area}: ${lines} lines`, 12);
printList("Largest src Areas", srcAreaTotals, ([area, lines]) => `${area}: ${lines} lines`, 20);
printList("Largest Files", largest, ({ file, lines }) => `${file}: ${lines} lines`, 20);
printList(
  "Hardening Signals",
  signalCounts(frontendFiles),
  ({ label, occurrences, files }) => `${label}: ${occurrences} occurrences in ${files} files`
);
printList(
  "Route Surface Counts",
  [...routeSurfaceTotals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  ([surface, count]) => `${surface}: ${count} routed path(s)`
);
