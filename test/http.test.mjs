import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import express from "express";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

// ---- Faux Zoho (accounts + API) ----
const fake = express();
fake.use(express.json());
let tokenCalls = 0;
let currentToken = "tok-1";
const seen = [];
fake.post("/oauth/v2/token", (req, res) => {
  tokenCalls++;
  currentToken = `tok-${tokenCalls}`;
  res.json({ access_token: currentToken, expires_in: 3600, api_domain: "http://fake" });
});
fake.use((req, res, next) => {
  seen.push({ method: req.method, url: req.originalUrl, auth: req.header("authorization"), body: req.body });
  if (req.header("authorization") !== `Zoho-oauthtoken ${currentToken}`) {
    return res.status(401).json({ code: "INVALID_TOKEN", message: "invalid oauth token" });
  }
  next();
});
fake.get("/crm/v6/settings/modules", (_req, res) => {
  res.json({ modules: [{ api_name: "Accounts", plural_label: "Sociétés", singular_label: "Société", generated_type: "default", api_supported: true, visible: true }] });
});
fake.get("/crm/v6/Accounts", (req, res) => {
  res.json({ data: [{ id: "1", Account_Name: "ACME" }], info: { fields: req.query.fields, per_page: Number(req.query.per_page) } });
});
fake.post("/crm/v6/Accounts", (req, res) => {
  res.json({ data: req.body.data.map((_, i) => ({ code: "SUCCESS", details: { id: String(100 + i) } })) });
});
fake.get("/crm/v6/Contacts", (_req, res) => res.status(204).end());

let fakeServer;
let child;
const PORT = 3999;
const FAKE_PORT = 3998;
const API_KEY = "test-key";

function waitFor(url, tries = 50) {
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const r = await fetch(url);
        if (r.ok) return resolve();
      } catch {}
      if (--tries <= 0) return reject(new Error("serveur non démarré"));
      setTimeout(tick, 100);
    };
    tick();
  });
}

before(async () => {
  await new Promise((r) => (fakeServer = fake.listen(FAKE_PORT, r)));
  child = spawn(process.execPath, ["dist/http.js"], {
    env: {
      ...process.env,
      PORT: String(PORT),
      MCP_API_KEY: API_KEY,
      ZOHO_CLIENT_ID: "cid",
      ZOHO_CLIENT_SECRET: "csecret",
      ZOHO_REFRESH_TOKEN: "rtoken",
      ZOHO_DC: "eu",
      ZOHO_ACCOUNTS_URL: `http://127.0.0.1:${FAKE_PORT}`,
      ZOHO_API_DOMAIN: `http://127.0.0.1:${FAKE_PORT}`,
      ZOHO_READ_ONLY: "false",
      ZOHO_ALLOW_DELETE: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr.on("data", (d) => process.stderr.write(d));
  await waitFor(`http://127.0.0.1:${PORT}/health`);
});

after(() => {
  child?.kill();
  fakeServer?.close();
});

test("refuse sans clé API", async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.equal(r.status, 401);
});

test("Streamable HTTP : liste les outils et appelle Zoho avec refresh automatique", async () => {
  const client = new Client({ name: "test", version: "0.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PORT}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${API_KEY}` } },
  });
  await client.connect(transport);

  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.ok(names.includes("zoho_list_modules"));
  assert.ok(names.includes("zoho_create_records"));
  assert.ok(!names.includes("zoho_delete_records"), "delete désactivé par défaut");

  const modules = await client.callTool({ name: "zoho_list_modules", arguments: {} });
  assert.equal(modules.isError, undefined);
  assert.match(modules.content[0].text, /Accounts/);
  assert.equal(tokenCalls, 1, "un seul refresh au premier appel");

  const recs = await client.callTool({
    name: "zoho_get_records",
    arguments: { module: "Accounts", fields: ["id", "Account_Name"], per_page: 5 },
  });
  const parsed = JSON.parse(recs.content[0].text);
  assert.equal(parsed.data[0].Account_Name, "ACME");
  assert.equal(parsed.info.fields, "id,Account_Name");
  assert.equal(parsed.info.per_page, 5);
  assert.equal(tokenCalls, 1, "token en cache réutilisé");

  const empty = await client.callTool({ name: "zoho_get_records", arguments: { module: "Contacts", fields: ["id"] } });
  assert.deepEqual(JSON.parse(empty.content[0].text).data, []);

  const created = await client.callTool({
    name: "zoho_create_records",
    arguments: { module: "Accounts", records: [{ Account_Name: "Nouveau" }] },
  });
  assert.match(created.content[0].text, /SUCCESS/);

  // token invalidé côté Zoho → 401 → refresh + rejeu transparent
  currentToken = "revoked";
  const again = await client.callTool({ name: "zoho_list_modules", arguments: {} });
  assert.equal(again.isError, undefined);
  assert.equal(tokenCalls, 2, "refresh après 401");

  const bad = await client.callTool({
    name: "zoho_search_records",
    arguments: { module: "Accounts", criteria: "(A:equals:1)", email: "x@y.z" },
  });
  assert.equal(bad.isError, true);

  await client.close();
});

test("SSE legacy : liste les outils", async () => {
  const client = new Client({ name: "test-sse", version: "0.0.0" });
  const transport = new SSEClientTransport(new URL(`http://127.0.0.1:${PORT}/sse`), {
    requestInit: { headers: { Authorization: `Bearer ${API_KEY}` } },
    eventSourceInit: {
      fetch: (url, init) => fetch(url, { ...init, headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${API_KEY}` } }),
    },
  });
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.ok(tools.some((t) => t.name === "zoho_coql_query"));
  await client.close();
});
