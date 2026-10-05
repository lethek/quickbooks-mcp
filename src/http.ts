#!/usr/bin/env node
// Standalone Streamable HTTP entry point (container / self-hosted).
// Stateless: a fresh MCP server per request. Authentication is expected to be
// done by a reverse proxy (e.g. mcp-oauth-proxy); MCP_BEARER_TOKEN optionally
// adds a shared-secret check so other in-network callers cannot bypass it.

import { createServer as createHttpServer } from "http";
import type { IncomingMessage, ServerResponse } from "http";
import { timingSafeEqual } from "crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { setOutputMode } from "./utils/output.js";
import { toolDefinitions, executeTool } from "./tools/index.js";
import { parseAllowlist, filterTools, isToolAllowed } from "./tools/allowlist.js";

// Tool output must come back inline: there is no shared filesystem with the caller
setOutputMode("http");

const port = Number(process.env.PORT ?? 8080);
const bearerToken = process.env.MCP_BEARER_TOKEN;
const allowed = parseAllowlist(process.env.MCP_TOOL_ALLOWLIST);
const exposedTools = filterTools(toolDefinitions, allowed);
const MAX_BODY_BYTES = 1024 * 1024;

function createMcpServer(): Server {
  const server = new Server(
    { name: "quickbooks-mcp", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: exposedTools }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    if (!isToolAllowed(name, allowed)) {
      return { content: [{ type: "text", text: `Tool not available: ${name}` }], isError: true };
    }
    return executeTool(name, args as Record<string, unknown>);
  });
  return server;
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

function authorised(req: IncomingMessage): boolean {
  if (!bearerToken) return true;
  const header = req.headers.authorization ?? "";
  const given = Buffer.from(header.replace(/^Bearer\s+/i, ""));
  const expected = Buffer.from(bearerToken);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error("Request body too large");
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
}

const httpServer = createHttpServer(async (req, res) => {
  const path = (req.url ?? "/").split("?")[0];

  if (path === "/healthz") return send(res, 200, { status: "ok" });
  if (path !== "/mcp") return send(res, 404, { error: "not_found" });
  if (req.method !== "POST") {
    return send(res, 405, { error: "method_not_allowed" }, { Allow: "POST" });
  }
  if (!authorised(req)) return send(res, 401, { error: "unauthorized" });

  let body: unknown;
  try {
    body = await readJson(req);
  } catch (error) {
    return send(res, 400, { error: "bad_request", error_description: (error as Error).message });
  }

  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch (error) {
    console.error("MCP request failed:", error);
    if (!res.headersSent) send(res, 500, { error: "internal_error" });
  }
});

httpServer.listen(port, () => {
  const scope = allowed === null ? "all tools" : [...allowed].join(", ");
  console.error(`QuickBooks MCP server listening on :${port} (${scope})`);
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => httpServer.close(() => process.exit(0)));
}
