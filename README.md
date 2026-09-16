# zoho-crm-mcp — accéder à Zoho CRM depuis Superfasttt via MCP

Serveur MCP (Model Context Protocol) qui expose le Zoho CRM en outils
utilisables par les agents Superfasttt (Studio Agents v2, Agents v1, nœud
Agent des workflows). Il parle les trois transports MCP :

| Transport | Endpoint | Usage |
|---|---|---|
| Streamable HTTP (recommandé) | `POST https://<hôte>/mcp` | Serveur MCP distant dans Superfasttt |
| SSE (historique) | `GET https://<hôte>/sse` + `POST /messages` | Clients qui ne parlent que SSE |
| stdio | `node dist/stdio.js` | Si la plateforme lance des serveurs MCP en ligne de commande |

L'authentification Zoho se fait par **refresh token OAuth** (jamais de
connexion interactive) ; l'accès au serveur MCP est protégé par une **clé
statique** envoyée en `Authorization: Bearer <clé>` ou `X-API-Key: <clé>`.
Le datacenter **EU** (`accounts.zoho.eu` / `www.zohoapis.eu`) est celui par défaut.

## Outils exposés

Lecture : `zoho_list_modules`, `zoho_get_fields`, `zoho_get_users`,
`zoho_get_records`, `zoho_get_record`, `zoho_search_records`,
`zoho_coql_query`, `zoho_get_related_records`.

Écriture (désactivée si `ZOHO_READ_ONLY=true`) : `zoho_create_records`,
`zoho_update_records`, `zoho_upsert_records`, `zoho_add_note`, et
`zoho_delete_records` seulement si `ZOHO_ALLOW_DELETE=true`.

Limites Zoho respectées : 200 enregistrements max par lecture, 100 par
écriture, champs lookup au format `{ "id": "..." }`.

## 1. Créer les identifiants Zoho (une fois)

1. Aller sur <https://api-console.zoho.eu> → **Add Client** → **Self Client** → Create.
2. Onglet **Client Secret** : noter `Client ID` et `Client Secret`.
3. Onglet **Generate Code** : scope
   `ZohoCRM.modules.ALL,ZohoCRM.settings.ALL,ZohoCRM.users.READ,ZohoCRM.coql.READ`,
   durée 10 minutes, Create → copier le code (utilisable une seule fois).
4. Échanger le code contre un refresh token permanent :

```bash
npm install
node scripts/get-refresh-token.mjs --dc eu --client-id 1000.XXXX --client-secret YYYY --code 1000.ZZZZ
```

Le script affiche les lignes à coller dans `.env`.

## 2. Configurer et lancer

```bash
cp .env.example .env      # renseigner ZOHO_* et MCP_API_KEY (openssl rand -hex 32)
npm install
npm run build
npm start                 # http://localhost:3000/mcp
```

Ou avec Docker :

```bash
docker compose up -d --build
curl http://localhost:3000/health
```

Vérification rapide de bout en bout (liste des modules) :

```bash
curl -s -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer $MCP_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"zoho_list_modules","arguments":{}}}'
```

## 3. Exposer le serveur sur Internet

Superfasttt est un SaaS : le serveur doit être joignable en HTTPS depuis
`api.superfasttt.ai`. Options, par ordre de simplicité :

- **VPS / serveur SPIN existant** : `docker compose up -d` + reverse proxy
  (Caddy, Traefik, Nginx) avec certificat Let's Encrypt, ex. `https://mcp-zoho.specialisteinternet.fr`.
- **PaaS Docker** (Railway, Render, Fly.io, Koyeb, Scaleway Containers) :
  pointer sur ce dépôt, le `Dockerfile` suffit, renseigner les variables d'environnement.
- **Test rapide sans déploiement** : `npm start` en local + tunnel
  (`ngrok http 3000` ou `cloudflared tunnel --url http://localhost:3000`).

Ne jamais exposer le serveur sans `MCP_API_KEY`. Pour restreindre encore,
mettre `ZOHO_READ_ONLY=true` sur une instance dédiée aux agents de consultation.

## 4. Brancher dans Superfasttt

1. Admin `https://specialisteinternet.admin.superfasttt.ai/fr/agent-tools/mcp`
   → ajouter un serveur MCP **personnalisé** :
   - Nom : `Zoho CRM`
   - URL : `https://<votre-hôte>/mcp` (transport Streamable HTTP ; si le
     formulaire ne propose que SSE, utiliser `https://<votre-hôte>/sse`)
   - En-tête : `Authorization: Bearer <MCP_API_KEY>` (ou `X-API-Key`)
   - Si la plateforme lance les serveurs MCP en commande (comme pour
     Filesystem/Memory) : commande `node`, arguments `/chemin/dist/stdio.js`,
     variables d'environnement = contenu de `.env`.
2. Studio Agents v2 → agent → **Capacités → Outils** → cocher le serveur
   `Zoho CRM` et les outils voulus. Même chose dans Agents v1 → outils MCP,
   et donc dans le nœud **Agent** des workflows.
3. Dans les instructions de l'agent, indiquer d'appeler d'abord
   `zoho_list_modules` / `zoho_get_fields`, et rappeler les conventions du
   CRM (champs `Statut`, `Origine`, lookups `Macro_secteur1`, `Sous_Secteur`,
   `Metier1` en `{ "id": "..." }`, jamais `Macro_secteur1` et `Sous_Secteur`
   dans le même appel).
4. Pour les écritures, activer une **Validation humaine** sur les outils
   `zoho_create_records` / `zoho_update_records` / `zoho_upsert_records`.
5. Tester dans l'onglet **Tester** : « Liste les sociétés créées cette semaine ».

## Alternative : le MCP hébergé par Zoho

Zoho propose ses propres serveurs MCP hébergés (<https://www.zoho.com/mcp/>).
Ils s'authentifient en OAuth interactif (navigateur), ce qui convient à
Claude Desktop mais rarement à une plateforme serveur comme Superfasttt qui
attend une URL + un en-tête fixe. Ce dépôt existe pour cette raison :
l'authentification est portée par le refresh token, côté serveur.

## Développement

```bash
npm run dev          # tsx, rechargement manuel
npm run typecheck
npm test             # build + test d'intégration contre un faux Zoho (aucun réseau requis)
```

Structure : `src/config.ts` (variables d'environnement, datacenters),
`src/zoho.ts` (client REST + refresh automatique), `src/server.ts` (outils
MCP), `src/http.ts` (Express : `/mcp`, `/sse`, `/health`, auth),
`src/stdio.ts`, `scripts/get-refresh-token.mjs`.
