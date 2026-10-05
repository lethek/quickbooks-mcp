// Tool allowlist for remote (HTTP) deployments

type NamedTool = { name: string };

// Default when MCP_TOOL_ALLOWLIST is unset: just what the invoice routine needs
const DEFAULT_ALLOWLIST = [
  "get_company_info",
  "query",
  "list_tax_codes",
  "create_invoice",
  "send_invoice",
];

// Never exposed remotely: it opens a local OAuth callback and is meaningless off-box
const NEVER_REMOTE = new Set(["qbo_authenticate"]);

/**
 * Parse a comma-separated allowlist. "*" means every tool (except those that
 * can never run remotely). Returns the set of allowed names, or null for "all".
 */
export function parseAllowlist(raw: string | undefined): Set<string> | null {
  const names = (raw ?? "")
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);
  if (names.length === 0) return new Set(DEFAULT_ALLOWLIST);
  if (names.includes("*")) return null;
  return new Set(names);
}

export function isToolAllowed(name: string, allowed: Set<string> | null): boolean {
  if (NEVER_REMOTE.has(name)) return false;
  return allowed === null || allowed.has(name);
}

export function filterTools<T extends NamedTool>(tools: T[], allowed: Set<string> | null): T[] {
  return tools.filter((t) => isToolAllowed(t.name, allowed));
}
