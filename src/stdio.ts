#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { ZohoClient } from "./zoho.js";
import { buildServer } from "./server.js";

const cfg = loadConfig();
const server = buildServer(cfg, new ZohoClient(cfg));
await server.connect(new StdioServerTransport());
