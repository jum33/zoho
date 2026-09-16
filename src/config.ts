import "dotenv/config";

const DC_HOSTS: Record<string, { accounts: string; api: string }> = {
  eu: { accounts: "https://accounts.zoho.eu", api: "https://www.zohoapis.eu" },
  com: { accounts: "https://accounts.zoho.com", api: "https://www.zohoapis.com" },
  in: { accounts: "https://accounts.zoho.in", api: "https://www.zohoapis.in" },
  au: { accounts: "https://accounts.zoho.com.au", api: "https://www.zohoapis.com.au" },
  jp: { accounts: "https://accounts.zoho.jp", api: "https://www.zohoapis.jp" },
  ca: { accounts: "https://accounts.zohocloud.ca", api: "https://www.zohoapis.ca" },
  sa: { accounts: "https://accounts.zoho.sa", api: "https://www.zohoapis.sa" },
};

function bool(v: string | undefined, def = false): boolean {
  if (v === undefined || v === "") return def;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variable d'environnement manquante : ${name}`);
  return v;
}

export interface Config {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  accountsUrl: string;
  apiBase: string;
  apiVersion: string;
  mcpApiKey: string | undefined;
  port: number;
  readOnly: boolean;
  allowDelete: boolean;
}

export function loadConfig(): Config {
  const dc = (process.env.ZOHO_DC ?? "eu").toLowerCase();
  const hosts = DC_HOSTS[dc];
  if (!hosts) throw new Error(`ZOHO_DC inconnu : ${dc} (valeurs : ${Object.keys(DC_HOSTS).join(", ")})`);
  const apiVersion = process.env.ZOHO_API_VERSION ?? "v6";
  return {
    clientId: required("ZOHO_CLIENT_ID"),
    clientSecret: required("ZOHO_CLIENT_SECRET"),
    refreshToken: required("ZOHO_REFRESH_TOKEN"),
    accountsUrl: process.env.ZOHO_ACCOUNTS_URL ?? hosts.accounts,
    apiBase: `${process.env.ZOHO_API_DOMAIN ?? hosts.api}/crm/${apiVersion}`,
    apiVersion,
    mcpApiKey: process.env.MCP_API_KEY || undefined,
    port: Number(process.env.PORT ?? 3000),
    readOnly: bool(process.env.ZOHO_READ_ONLY),
    allowDelete: bool(process.env.ZOHO_ALLOW_DELETE),
  };
}
