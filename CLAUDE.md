# Dépôt « zoho-crm-mcp » : consignes pour Claude

Ce dépôt contient un serveur MCP en TypeScript (Node 20 ou plus) qui expose le Zoho CRM de Jean-Marc aux agents Superfasttt. `README.md` décrit les outils, la configuration, le déploiement et le branchement dans Superfasttt.

## Organisation

- `src/config.ts` : variables d'environnement et datacenters.
- `src/zoho.ts` : client REST Zoho avec rafraîchissement automatique du jeton.
- `src/server.ts` : définition des outils MCP.
- `src/http.ts` : serveur Express (`/mcp`, `/sse`, `/health`) et contrôle de la clé d'accès. `src/stdio.ts` : transport en ligne de commande.
- `test/` : test d'intégration contre un faux Zoho, sans réseau.

## Règles de travail

- Écris en français (documentation, commits, réponses).
- Le dépôt est public : jamais de secret (identifiants Zoho, refresh token, `MCP_API_KEY`) dans un fichier, un commit ou le chat. Seul `.env.example` est versionné, avec des valeurs factices.
- Datacenter EU par défaut : `accounts.zoho.eu` et `www.zohoapis.eu`.
- Respecte les limites Zoho : 200 enregistrements par lecture, 100 par écriture, lookups au format `{ "id": "..." }`.
- Les écritures restent désactivables (`ZOHO_READ_ONLY=true`) et la suppression reste désactivée par défaut (`ZOHO_ALLOW_DELETE`). Ne change pas ces valeurs par défaut sans l'accord de Jean-Marc.
- Un nouvel outil est ajouté dans `src/server.ts`, couvert par `test/` et listé dans `README.md`.
- Avant chaque commit : `npm run typecheck` puis `npm test`, tous deux au vert.
- N'appelle jamais le vrai CRM pour tester : utilise le faux Zoho des tests. Toute écriture dans le CRM de production se fait seulement après avoir annoncé ce qui va changer et obtenu la confirmation de Jean-Marc.
