#!/usr/bin/env node

import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(scriptDirectory, "..");
const repositoryRoot = resolve(frontendRoot, "..");
const backendRoot = resolve(repositoryRoot, "backend");

const DEFAULT_PORTS = Object.freeze({
  frontend: 4173,
  backend: 18080,
  s3: 15000,
});

const activeProcesses = new Set();
let shuttingDown = false;
let shutdownRequested;
const shutdownPromise = new Promise((resolveShutdown) => {
  shutdownRequested = resolveShutdown;
});
let unexpectedFailure;
let reportUnexpectedFailure;
const unexpectedFailurePromise = new Promise((resolveFailure) => {
  reportUnexpectedFailure = resolveFailure;
});

function usage() {
  return `Usage: node scripts/agent-ui.mjs <serve|check> [options]

Options:
  --frontend-port <port>  Frontend origin port (default: ${DEFAULT_PORTS.frontend})
  --backend-port <port>   FastAPI port (default: ${DEFAULT_PORTS.backend})
  --s3-port <port>        Moto S3 port (default: ${DEFAULT_PORTS.s3})
  --help                  Show this help
`;
}

function parsePort(rawValue, optionName) {
  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`${optionName} must be an integer between 1 and 65535`);
  }
  return value;
}

export function parseArguments(argv) {
  const args = [...argv];
  const mode = args.shift();
  if (mode === "--help" || mode === "-h") {
    return { help: true, mode: "serve", ports: { ...DEFAULT_PORTS } };
  }
  if (mode !== "serve" && mode !== "check") {
    throw new Error("The first argument must be 'serve' or 'check'");
  }

  const ports = { ...DEFAULT_PORTS };
  const optionToPort = {
    "--frontend-port": "frontend",
    "--backend-port": "backend",
    "--s3-port": "s3",
  };

  while (args.length > 0) {
    const option = args.shift();
    if (option === "--help" || option === "-h") {
      return { help: true, mode, ports };
    }
    const [name, inlineValue] = option.split("=", 2);
    const portName = optionToPort[name];
    if (!portName) {
      throw new Error(`Unknown option: ${option}`);
    }
    const rawValue = inlineValue ?? args.shift();
    if (rawValue === undefined) {
      throw new Error(`${name} requires a value`);
    }
    ports[portName] = parsePort(rawValue, name);
  }

  if (new Set(Object.values(ports)).size !== Object.values(ports).length) {
    throw new Error("Frontend, backend, and S3 ports must be distinct");
  }
  return { help: false, mode, ports };
}

function checkPortAvailable(port) {
  return new Promise((resolveCheck, rejectCheck) => {
    const server = createServer();
    server.unref();
    server.once("error", (error) => rejectCheck(error));
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      server.close((error) => (error ? rejectCheck(error) : resolveCheck()));
    });
  });
}

export async function assertPortsAvailable(ports) {
  for (const [label, port] of Object.entries(ports)) {
    try {
      await checkPortAvailable(port);
    } catch (error) {
      if (error?.code === "EADDRINUSE") {
        throw new Error(`${label} port ${port} is already in use`);
      }
      if (error?.code === "EACCES" || error?.code === "EPERM") {
        throw new Error(
          `Loopback binding is not permitted for ${label} port ${port}; allow local process networking and retry`,
        );
      }
      throw error;
    }
  }
}

async function resolveExecutable(candidates, description) {
  for (const candidate of candidates) {
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Try the next repository-local executable.
    }
  }
  throw new Error(`${description} was not found; install the repository dependencies first`);
}

function spawnProcess(label, command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd ?? frontendRoot,
    env: options.env ?? process.env,
    stdio: "inherit",
  });
  child.agentUiLabel = label;
  activeProcesses.add(child);
  child.once("exit", (code, signal) => {
    activeProcesses.delete(child);
    if (options.longLived && !shuttingDown && !unexpectedFailure) {
      unexpectedFailure = new Error(
        `${label} exited unexpectedly (${signal ? `signal ${signal}` : `status ${code}`})`,
      );
      reportUnexpectedFailure(unexpectedFailure);
    }
  });
  return child;
}

function waitForProcess(child, label) {
  return new Promise((resolveWait, rejectWait) => {
    child.once("error", rejectWait);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolveWait();
        return;
      }
      rejectWait(
        new Error(`${label} failed (${signal ? `signal ${signal}` : `status ${code}`})`),
      );
    });
  });
}

async function waitForHttp(url, label, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (unexpectedFailure) throw unexpectedFailure;
    try {
      const response = await globalThis.fetch(url, {
        redirect: "manual",
        signal: globalThis.AbortSignal.timeout(2_000),
      });
      if (response.ok) return;
    } catch {
      // The local service may still be starting.
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${label} at ${url}`);
}

async function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolveExit) => child.once("exit", resolveExit));
  child.kill("SIGTERM");
  await Promise.race([
    exited,
    delay(5_000),
  ]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await exited;
  }
}

async function cleanup() {
  if (shuttingDown) return;
  shuttingDown = true;
  const children = [...activeProcesses].reverse();
  await Promise.all(children.map((child) => stopProcess(child)));
}

function installSignalHandlers() {
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => shutdownRequested(signal));
  }
}

async function runPlaywright(mode, environment, playwrightExecutable) {
  const args = ["test", "-c", "playwright.agent.config.ts"];
  if (mode === "serve") args.push("--project=setup");
  const child = spawnProcess("Playwright authenticated setup", playwrightExecutable, args, {
    env: environment,
  });
  await waitForProcess(child, "Playwright authenticated setup");
}

async function run(options) {
  const { frontend, backend, s3 } = options.ports;
  const frontendOrigin = `http://localhost:${frontend}`;
  const backendOrigin = `http://127.0.0.1:${backend}`;
  const s3Origin = `http://127.0.0.1:${s3}`;

  await assertPortsAvailable(options.ports);
  const pythonExecutable = await resolveExecutable(
    [resolve(backendRoot, ".venv/bin/python3"), resolve(backendRoot, ".venv/bin/python")],
    "Backend virtualenv Python",
  );
  const motoExecutable = await resolveExecutable(
    [resolve(backendRoot, ".venv/bin/moto_server")],
    "Moto server",
  );
  const viteExecutable = await resolveExecutable(
    [resolve(frontendRoot, "node_modules/.bin/vite")],
    "Vite",
  );
  const playwrightExecutable = await resolveExecutable(
    [resolve(frontendRoot, "node_modules/.bin/playwright")],
    "Playwright",
  );

  const environment = {
    ...process.env,
    CI: "",
    ENV_STORAGE_ENDPOINTS: "",
    E2E_BACKEND_PORT: String(backend),
    E2E_FRONTEND_BASE_URL: frontendOrigin,
    E2E_S3_ENDPOINT: s3Origin,
    VITE_API_PROXY_TARGET: backendOrigin,
  };

  spawnProcess("Moto S3", motoExecutable, ["-H", "127.0.0.1", "-p", String(s3)], {
    env: environment,
    longLived: true,
  });
  spawnProcess(
    "FastAPI E2E backend",
    pythonExecutable,
    [resolve(backendRoot, "tests_browser_e2e/serve.py")],
    { cwd: backendRoot, env: environment, longLived: true },
  );
  spawnProcess(
    "Vite frontend",
    viteExecutable,
    ["--host", "127.0.0.1", "--port", String(frontend), "--strictPort"],
    { env: environment, longLived: true },
  );

  await Promise.all([
    waitForHttp(`${s3Origin}/`, "Moto S3"),
    waitForHttp(`${backendOrigin}/health`, "FastAPI backend"),
    waitForHttp(`${frontendOrigin}/setup/first-admin`, "Vite frontend"),
  ]);
  await runPlaywright(options.mode, environment, playwrightExecutable);
  if (unexpectedFailure) throw unexpectedFailure;

  if (options.mode === "check") {
    process.stdout.write("Authenticated agent UI check passed for Admin and Browser.\n");
    return;
  }

  process.stdout.write(`\nAuthenticated agent UI is ready from the current checkout.\n\n`);
  process.stdout.write(`Admin:   ${frontendOrigin}/admin\n`);
  process.stdout.write(`Browser: ${frontendOrigin}/browser\n\n`);
  process.stdout.write("From frontend/, open a reusable Playwright CLI session with:\n");
  process.stdout.write(
    `  "$PWCLI" --session bucketreef-admin --config playwright-cli.agent-admin.json open ${frontendOrigin}/admin\n`,
  );
  process.stdout.write(
    `  "$PWCLI" --session bucketreef-browser --config playwright-cli.agent-browser.json open ${frontendOrigin}/browser\n`,
  );
  process.stdout.write("\nPress Ctrl+C in this terminal to stop only these isolated services.\n");

  const result = await Promise.race([
    shutdownPromise.then(() => null),
    unexpectedFailurePromise,
  ]);
  if (result instanceof Error) throw result;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.help) {
    process.stdout.write(usage());
    return;
  }
  installSignalHandlers();
  try {
    await run(options);
  } finally {
    await cleanup();
  }
}

const invokedAsScript = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href === import.meta.url
  : false;
if (invokedAsScript) {
  main().catch((error) => {
    process.stderr.write(`Agent UI error: ${error.message}\n`);
    process.exitCode = 1;
  });
}
