import express, { type Request, type Response, type NextFunction } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { loadConfig } from "./config.js";
import { ZohoClient } from "./zoho.js";
import { buildServer } from "./server.js";

const cfg = loadConfig();
const zoho = new ZohoClient(cfg);
const app = express();
app.set("trust proxy", true);

// ---- Authentification par clé statique (Bearer ou X-API-Key) ----
function auth(req: Request, res: Response, next: NextFunction) {
  if (!cfg.mcpApiKey) return next(); // aucune clé configurée : accès libre (déconseillé hors dev)
  const header = req.header("authorization") ?? "";
  const bearer = header.match(/^Bearer\s+(.+)$/i)?.[1];
  const apiKey = req.header("x-api-key");
  if (bearer === cfg.mcpApiKey || apiKey === cfg.mcpApiKey) return next();
  res.status(401).json({ error: "Unauthorized" });
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, name: "zoho-crm-mcp", readOnly: cfg.readOnly });
});

// ---- Transport Streamable HTTP (recommandé), sans état : /mcp ----
app.post("/mcp", auth, express.json({ limit: "4mb" }), async (req, res) => {
  const server = buildServer(cfg, zoho);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("Erreur /mcp :", err);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  }
});
app.get("/mcp", auth, (_req, res) => {
  // pas de flux serveur→client en mode sans état
  res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
});
app.delete("/mcp", auth, (_req, res) => {
  res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
});

// ---- Transport SSE historique (clients qui ne parlent pas Streamable HTTP) : /sse + /messages ----
const sseSessions = new Map<string, SSEServerTransport>();
app.get("/sse", auth, async (req, res) => {
  const transport = new SSEServerTransport("/messages", res);
  const server = buildServer(cfg, zoho);
  sseSessions.set(transport.sessionId, transport);
  res.on("close", () => {
    sseSessions.delete(transport.sessionId);
    server.close();
  });
  await server.connect(transport);
});
app.post("/messages", auth, async (req, res) => {
  const sessionId = String(req.query.sessionId ?? "");
  const transport = sseSessions.get(sessionId);
  if (!transport) {
    res.status(400).json({ error: "Session SSE inconnue" });
    return;
  }
  await transport.handlePostMessage(req, res);
});

app.listen(cfg.port, () => {
  console.log(`zoho-crm-mcp à l'écoute sur le port ${cfg.port}`);
  console.log(`  Streamable HTTP : POST /mcp`);
  console.log(`  SSE (legacy)    : GET /sse, POST /messages`);
  console.log(`  Auth            : ${cfg.mcpApiKey ? "clé MCP_API_KEY requise" : "AUCUNE (définir MCP_API_KEY)"}`);
  console.log(`  Mode            : ${cfg.readOnly ? "lecture seule" : "lecture/écriture"}${cfg.allowDelete ? " + suppression" : ""}`);
});
