import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Config } from "./config.js";
import { ZohoApiError, ZohoClient } from "./zoho.js";

const MODULE_DESC =
  "Nom API du module Zoho CRM (ex. Leads, Contacts, Accounts, Deals, Tasks, ou un module personnalisé comme Metiers). Utiliser zoho_list_modules pour la liste exacte.";

const recordSchema = z.record(z.unknown()).describe(
  'Enregistrement au format API Zoho : { "Champ_API": valeur }. Les champs lookup se renseignent avec { "id": "..." }.',
);

function text(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function errorResult(err: unknown) {
  if (err instanceof ZohoApiError) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ error: err.message, status: err.status, details: err.body }, null, 2),
        },
      ],
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }] };
}

async function run(fn: () => Promise<unknown>) {
  try {
    return text(await fn());
  } catch (err) {
    return errorResult(err);
  }
}

/**
 * Construit une instance McpServer avec les outils Zoho CRM.
 * Une nouvelle instance est créée par connexion (les transports MCP
 * n'acceptent qu'un seul serveur connecté).
 */
export function buildServer(cfg: Config, zoho: ZohoClient): McpServer {
  const server = new McpServer(
    { name: "zoho-crm-mcp", version: "1.0.0" },
    {
      instructions: [
        "Serveur MCP donnant accès au Zoho CRM de l'organisation.",
        "Commencer par zoho_list_modules puis zoho_get_fields pour connaître les noms API exacts des modules et des champs avant toute lecture ou écriture.",
        "Les lectures paginent par 200 maximum. Les écritures acceptent 100 enregistrements maximum par appel.",
        "Les champs lookup se renseignent avec un objet { \"id\": \"...\" }.",
        cfg.readOnly ? "Ce serveur est en lecture seule : aucune écriture n'est possible." : "",
      ]
        .filter(Boolean)
        .join("\n"),
    },
  );

  // ---------- Lecture ----------
  server.registerTool(
    "zoho_list_modules",
    {
      title: "Lister les modules",
      description: "Liste les modules (standards et personnalisés) du CRM avec leur nom API, leur libellé et leur visibilité.",
      inputSchema: {},
    },
    async () =>
      run(async () => {
        const res = (await zoho.listModules()) as { modules?: Array<Record<string, unknown>> };
        return (res.modules ?? []).map((m) => ({
          api_name: m.api_name,
          plural_label: m.plural_label,
          singular_label: m.singular_label,
          generated_type: m.generated_type,
          api_supported: m.api_supported,
          visible: m.visible,
        }));
      }),
  );

  server.registerTool(
    "zoho_get_fields",
    {
      title: "Décrire les champs d'un module",
      description:
        "Renvoie les champs d'un module : nom API, libellé, type de donnée, obligatoire, valeurs de picklist, module cible des lookups. Indispensable avant d'écrire.",
      inputSchema: { module: z.string().describe(MODULE_DESC) },
    },
    async ({ module }) =>
      run(async () => {
        const res = (await zoho.getFields(module)) as { fields?: Array<Record<string, unknown>> };
        return (res.fields ?? []).map((f) => ({
          api_name: f.api_name,
          field_label: f.field_label,
          data_type: f.data_type,
          json_type: f.json_type,
          system_mandatory: f.system_mandatory,
          read_only: f.read_only,
          custom_field: f.custom_field,
          length: f.length,
          pick_list_values: Array.isArray(f.pick_list_values)
            ? (f.pick_list_values as Array<{ display_value?: string; actual_value?: string }>).map(
                (p) => p.actual_value ?? p.display_value,
              )
            : undefined,
          lookup: f.lookup && typeof f.lookup === "object" && "module" in (f.lookup as object)
            ? (f.lookup as { module?: { api_name?: string } }).module?.api_name
            : undefined,
        }));
      }),
  );

  server.registerTool(
    "zoho_get_users",
    {
      title: "Lister les utilisateurs",
      description: "Liste les utilisateurs du CRM (id, nom, email, rôle, profil). Utile pour renseigner le champ Owner.",
      inputSchema: {
        type: z
          .enum(["AllUsers", "ActiveUsers", "DeactiveUsers", "AdminUsers", "CurrentUser"])
          .default("ActiveUsers")
          .describe("Filtre Zoho sur le type d'utilisateur"),
      },
    },
    async ({ type }) =>
      run(async () => {
        const res = (await zoho.getUsers(type)) as { users?: Array<Record<string, unknown>> };
        return (res.users ?? []).map((u) => ({
          id: u.id,
          full_name: u.full_name,
          email: u.email,
          status: u.status,
          role: (u.role as { name?: string } | undefined)?.name,
          profile: (u.profile as { name?: string } | undefined)?.name,
        }));
      }),
  );

  server.registerTool(
    "zoho_get_records",
    {
      title: "Lire des enregistrements",
      description:
        "Récupère une page d'enregistrements d'un module. Le paramètre fields est obligatoire (API v6). Max 200 par page.",
      inputSchema: {
        module: z.string().describe(MODULE_DESC),
        fields: z.array(z.string()).min(1).describe("Noms API des champs à renvoyer, ex. [\"id\",\"Account_Name\",\"Phone\"]"),
        page: z.number().int().min(1).default(1),
        per_page: z.number().int().min(1).max(200).default(200),
        sort_by: z.string().optional().describe("Nom API du champ de tri"),
        sort_order: z.enum(["asc", "desc"]).optional(),
        cvid: z.string().optional().describe("ID d'une vue personnalisée pour filtrer"),
      },
    },
    async (a) => run(() => zoho.getRecords(a.module, a)),
  );

  server.registerTool(
    "zoho_get_record",
    {
      title: "Lire un enregistrement",
      description: "Récupère un enregistrement par son id, avec tous ses champs ou une sélection.",
      inputSchema: {
        module: z.string().describe(MODULE_DESC),
        id: z.string().describe("ID Zoho de l'enregistrement"),
        fields: z.array(z.string()).optional(),
      },
    },
    async ({ module, id, fields }) => run(() => zoho.getRecord(module, id, fields)),
  );

  server.registerTool(
    "zoho_search_records",
    {
      title: "Rechercher des enregistrements",
      description:
        "Recherche dans un module par critères Zoho, email, téléphone ou mot-clé. " +
        "Syntaxe criteria : (Champ:operateur:valeur), opérateurs equals, not_equal, starts_with, in, contains (texte), " +
        "greater_than, less_than, between (dates/nombres), combinables avec and/or : ((Account_Name:equals:ACME)and(Ville:equals:Rennes)). " +
        "Fournir exactement un des paramètres criteria, email, phone ou word.",
      inputSchema: {
        module: z.string().describe(MODULE_DESC),
        criteria: z.string().optional(),
        email: z.string().optional(),
        phone: z.string().optional(),
        word: z.string().optional().describe("Recherche globale plein texte"),
        fields: z.array(z.string()).optional().describe("Champs à renvoyer (sinon tous)"),
        page: z.number().int().min(1).default(1),
        per_page: z.number().int().min(1).max(200).default(200),
      },
    },
    async (a) =>
      run(async () => {
        const provided = [a.criteria, a.email, a.phone, a.word].filter((v) => v !== undefined && v !== "");
        if (provided.length !== 1) {
          throw new Error("Fournir exactement un paramètre parmi criteria, email, phone ou word.");
        }
        return zoho.searchRecords(a.module, a);
      }),
  );

  server.registerTool(
    "zoho_coql_query",
    {
      title: "Requête COQL",
      description:
        "Exécute une requête COQL (SQL-like Zoho). Exemple : select id, Account_Name, Phone from Accounts where Ville = 'Rennes' limit 0, 200. " +
        "Max 200 lignes par requête, offset max 2000 ; toujours préciser limit offset, count. Les lookups se lisent avec Lookup.Champ (ex. Account_Name.Account_Name).",
      inputSchema: { select_query: z.string().describe("Requête COQL complète") },
    },
    async ({ select_query }) => run(() => zoho.coql(select_query)),
  );

  server.registerTool(
    "zoho_get_related_records",
    {
      title: "Lire une liste liée",
      description:
        "Récupère les enregistrements liés à un enregistrement (ex. Contacts d'un compte, Notes, Deals, Activities). related_list = nom API de la liste liée.",
      inputSchema: {
        module: z.string().describe(MODULE_DESC),
        id: z.string(),
        related_list: z.string().describe("Nom API de la liste liée, ex. Contacts, Notes, Deals, Tasks, Attachments"),
        fields: z.array(z.string()).optional(),
        page: z.number().int().min(1).default(1),
        per_page: z.number().int().min(1).max(200).default(200),
      },
    },
    async (a) => run(() => zoho.getRelatedRecords(a.module, a.id, a.related_list, a.fields, a.page, a.per_page)),
  );

  if (cfg.readOnly) return server;

  // ---------- Écriture ----------
  const triggerSchema = z
    .array(z.enum(["workflow", "approval", "blueprint"]))
    .optional()
    .describe("Automatisations Zoho à déclencher. Omettre = comportement par défaut de Zoho (toutes). [] = aucune.");

  server.registerTool(
    "zoho_create_records",
    {
      title: "Créer des enregistrements",
      description: "Crée jusqu'à 100 enregistrements dans un module. Vérifier les champs obligatoires avec zoho_get_fields.",
      inputSchema: {
        module: z.string().describe(MODULE_DESC),
        records: z.array(recordSchema).min(1).max(100),
        trigger: triggerSchema,
      },
    },
    async ({ module, records, trigger }) => run(() => zoho.createRecords(module, records, trigger)),
  );

  server.registerTool(
    "zoho_update_records",
    {
      title: "Mettre à jour des enregistrements",
      description: "Met à jour jusqu'à 100 enregistrements. Chaque enregistrement doit contenir son champ id.",
      inputSchema: {
        module: z.string().describe(MODULE_DESC),
        records: z.array(recordSchema.refine((r) => typeof r.id === "string" && r.id.length > 0, "Le champ id est obligatoire")).min(1).max(100),
        trigger: triggerSchema,
      },
    },
    async ({ module, records, trigger }) => run(() => zoho.updateRecords(module, records, trigger)),
  );

  server.registerTool(
    "zoho_upsert_records",
    {
      title: "Créer ou mettre à jour (upsert)",
      description:
        "Insère ou met à jour jusqu'à 100 enregistrements selon des champs de dédoublonnage (ex. Email pour Contacts, Account_Name pour Accounts).",
      inputSchema: {
        module: z.string().describe(MODULE_DESC),
        records: z.array(recordSchema).min(1).max(100),
        duplicate_check_fields: z.array(z.string()).optional().describe("Champs servant à détecter un doublon"),
        trigger: triggerSchema,
      },
    },
    async ({ module, records, duplicate_check_fields, trigger }) =>
      run(() => zoho.upsertRecords(module, records, duplicate_check_fields, trigger)),
  );

  server.registerTool(
    "zoho_add_note",
    {
      title: "Ajouter une note",
      description: "Ajoute une note à un enregistrement (compte, contact, affaire...).",
      inputSchema: {
        module: z.string().describe(MODULE_DESC),
        id: z.string(),
        title: z.string().optional(),
        content: z.string().min(1),
      },
    },
    async ({ module, id, title, content }) => run(() => zoho.addNote(module, id, title, content)),
  );

  if (cfg.allowDelete) {
    server.registerTool(
      "zoho_delete_records",
      {
        title: "Supprimer des enregistrements",
        description: "Supprime jusqu'à 100 enregistrements (envoyés dans la corbeille Zoho). Action irréversible côté agent : demander confirmation à l'utilisateur.",
        inputSchema: {
          module: z.string().describe(MODULE_DESC),
          ids: z.array(z.string()).min(1).max(100),
        },
      },
      async ({ module, ids }) => run(() => zoho.deleteRecords(module, ids)),
    );
  }

  return server;
}
