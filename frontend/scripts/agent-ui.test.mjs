import assert from "node:assert/strict";
import { createServer } from "node:net";
import { after, before, test } from "node:test";

import { assertPortsAvailable, parseArguments } from "./agent-ui.mjs";

let occupiedServer;
let occupiedPort;

before(async () => {
  occupiedServer = createServer();
  await new Promise((resolveListen, rejectListen) => {
    occupiedServer.once("error", rejectListen);
    occupiedServer.listen({ host: "127.0.0.1", port: 0 }, resolveListen);
  });
  occupiedPort = occupiedServer.address().port;
});

after(async () => {
  await new Promise((resolveClose, rejectClose) => {
    occupiedServer.close((error) => (error ? rejectClose(error) : resolveClose()));
  });
});

test("parses explicit distinct ports", () => {
  assert.deepEqual(
    parseArguments([
      "serve",
      "--frontend-port",
      "14173",
      "--backend-port=18081",
      "--s3-port",
      "15001",
    ]),
    {
      help: false,
      mode: "serve",
      ports: { frontend: 14173, backend: 18081, s3: 15001 },
    },
  );
});

test("rejects duplicate ports", () => {
  assert.throws(
    () => parseArguments(["check", "--frontend-port", "15001", "--s3-port", "15001"]),
    /must be distinct/,
  );
});

test("refuses to reuse an occupied port", async () => {
  await assert.rejects(
    assertPortsAvailable({ frontend: occupiedPort }),
    new RegExp(`frontend port ${occupiedPort} is already in use`),
  );
});
