#!/usr/bin/env node
/**
 * Obtient un refresh token Zoho CRM permanent à partir d'un "grant token"
 * généré dans la console API Zoho (client de type Self Client).
 *
 * Étapes :
 *  1. https://api-console.zoho.eu  →  Add Client → Self Client → Create
 *  2. Onglet "Generate Code" : scope
 *       ZohoCRM.modules.ALL,ZohoCRM.settings.ALL,ZohoCRM.users.READ,ZohoCRM.coql.READ
 *     durée 10 min → Create → copier le code.
 *  3. Exécuter :
 *       node scripts/get-refresh-token.mjs --dc eu --client-id ... --client-secret ... --code 1000.xxxx
 *
 * Affiche le refresh_token à mettre dans ZOHO_REFRESH_TOKEN. Le code n'est
 * utilisable qu'une seule fois et expire vite : relancer l'étape 2 en cas d'erreur.
 */
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith("--")) acc.push([cur.slice(2), arr[i + 1]]);
    return acc;
  }, []),
);

const dc = (args.dc ?? process.env.ZOHO_DC ?? "eu").toLowerCase();
const clientId = args["client-id"] ?? process.env.ZOHO_CLIENT_ID;
const clientSecret = args["client-secret"] ?? process.env.ZOHO_CLIENT_SECRET;
const code = args.code;

if (!clientId || !clientSecret || !code) {
  console.error("Usage : node scripts/get-refresh-token.mjs --dc eu --client-id <id> --client-secret <secret> --code <grant-token>");
  process.exit(1);
}

const hosts = { eu: "accounts.zoho.eu", com: "accounts.zoho.com", in: "accounts.zoho.in", au: "accounts.zoho.com.au", jp: "accounts.zoho.jp", ca: "accounts.zohocloud.ca", sa: "accounts.zoho.sa" };
const host = hosts[dc];
if (!host) {
  console.error(`Datacenter inconnu : ${dc}`);
  process.exit(1);
}

const res = await fetch(`https://${host}/oauth/v2/token`, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, client_secret: clientSecret, code }),
});
const json = await res.json();
if (!json.refresh_token) {
  console.error("Échec :", JSON.stringify(json, null, 2));
  process.exit(1);
}
console.log("\nZOHO_DC=" + dc);
console.log("ZOHO_CLIENT_ID=" + clientId);
console.log("ZOHO_CLIENT_SECRET=" + clientSecret);
console.log("ZOHO_REFRESH_TOKEN=" + json.refresh_token);
console.log("\nAPI domain renvoyé par Zoho :", json.api_domain);
