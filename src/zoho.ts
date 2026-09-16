import type { Config } from "./config.js";

export class ZohoApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = "ZohoApiError";
  }
}

type Method = "GET" | "POST" | "PUT" | "DELETE";

/**
 * Client REST Zoho CRM avec rafraîchissement automatique de l'access token
 * (grant_type=refresh_token). L'access token est gardé en mémoire et
 * renouvelé un peu avant son expiration, ou immédiatement sur INVALID_TOKEN.
 */
export class ZohoClient {
  private accessToken: string | null = null;
  private expiresAt = 0;
  private refreshing: Promise<string> | null = null;

  constructor(private readonly cfg: Config) {}

  private async refresh(): Promise<string> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      const body = new URLSearchParams({
        refresh_token: this.cfg.refreshToken,
        client_id: this.cfg.clientId,
        client_secret: this.cfg.clientSecret,
        grant_type: "refresh_token",
      });
      const res = await fetch(`${this.cfg.accountsUrl}/oauth/v2/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      const json = (await res.json().catch(() => ({}))) as {
        access_token?: string;
        expires_in?: number;
        error?: string;
      };
      if (!res.ok || !json.access_token) {
        throw new ZohoApiError(
          `Échec du rafraîchissement du token Zoho : ${json.error ?? res.status}`,
          res.status,
          json,
        );
      }
      this.accessToken = json.access_token;
      // marge de sécurité de 2 minutes
      this.expiresAt = Date.now() + ((json.expires_in ?? 3600) - 120) * 1000;
      return this.accessToken;
    })();
    try {
      return await this.refreshing;
    } finally {
      this.refreshing = null;
    }
  }

  private async token(): Promise<string> {
    if (this.accessToken && Date.now() < this.expiresAt) return this.accessToken;
    return this.refresh();
  }

  async request<T = unknown>(
    method: Method,
    path: string,
    opts: { query?: Record<string, string | number | boolean | undefined>; body?: unknown } = {},
    retry = true,
  ): Promise<T> {
    const url = new URL(`${this.cfg.apiBase}${path.startsWith("/") ? path : `/${path}`}`);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    }
    const headers: Record<string, string> = {
      Authorization: `Zoho-oauthtoken ${await this.token()}`,
    };
    let body: string | undefined;
    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.body);
    }
    const res = await fetch(url, { method, headers, body });

    // 204 = pas de contenu (ex. aucun enregistrement)
    if (res.status === 204) return { data: [], info: { count: 0 } } as T;

    const text = await res.text();
    let json: unknown = text;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      /* réponse non JSON, on garde le texte brut */
    }

    if (res.status === 401 && retry) {
      // token invalidé côté Zoho : on force un refresh et on rejoue une fois
      this.accessToken = null;
      return this.request<T>(method, path, opts, false);
    }
    if (!res.ok) {
      const code = (json as { code?: string; message?: string })?.code;
      const msg = (json as { message?: string })?.message;
      throw new ZohoApiError(
        `Zoho CRM ${method} ${path} → HTTP ${res.status}${code ? ` ${code}` : ""}${msg ? ` : ${msg}` : ""}`,
        res.status,
        json,
      );
    }
    return json as T;
  }

  // ---- Métadonnées ----
  listModules() {
    return this.request("GET", "/settings/modules");
  }
  getFields(module: string) {
    return this.request("GET", "/settings/fields", { query: { module } });
  }
  getUsers(type = "AllUsers") {
    return this.request("GET", "/users", { query: { type } });
  }

  // ---- Enregistrements ----
  getRecords(
    module: string,
    q: { fields: string[]; page?: number; per_page?: number; sort_by?: string; sort_order?: "asc" | "desc"; cvid?: string },
  ) {
    return this.request("GET", `/${module}`, {
      query: {
        fields: q.fields.join(","),
        page: q.page,
        per_page: q.per_page,
        sort_by: q.sort_by,
        sort_order: q.sort_order,
        cvid: q.cvid,
      },
    });
  }
  getRecord(module: string, id: string, fields?: string[]) {
    return this.request("GET", `/${module}/${id}`, { query: { fields: fields?.join(",") } });
  }
  searchRecords(
    module: string,
    q: { criteria?: string; email?: string; phone?: string; word?: string; fields?: string[]; page?: number; per_page?: number },
  ) {
    return this.request("GET", `/${module}/search`, {
      query: {
        criteria: q.criteria,
        email: q.email,
        phone: q.phone,
        word: q.word,
        fields: q.fields?.join(","),
        page: q.page,
        per_page: q.per_page,
      },
    });
  }
  coql(select_query: string) {
    return this.request("POST", "/coql", { body: { select_query } });
  }
  createRecords(module: string, data: Record<string, unknown>[], trigger?: string[]) {
    return this.request("POST", `/${module}`, { body: { data, ...(trigger ? { trigger } : {}) } });
  }
  updateRecords(module: string, data: Record<string, unknown>[], trigger?: string[]) {
    return this.request("PUT", `/${module}`, { body: { data, ...(trigger ? { trigger } : {}) } });
  }
  upsertRecords(module: string, data: Record<string, unknown>[], duplicate_check_fields?: string[], trigger?: string[]) {
    return this.request("POST", `/${module}/upsert`, {
      body: {
        data,
        ...(duplicate_check_fields ? { duplicate_check_fields } : {}),
        ...(trigger ? { trigger } : {}),
      },
    });
  }
  deleteRecords(module: string, ids: string[]) {
    return this.request("DELETE", `/${module}`, { query: { ids: ids.join(",") } });
  }
  getRelatedRecords(module: string, id: string, relatedList: string, fields?: string[], page?: number, per_page?: number) {
    return this.request("GET", `/${module}/${id}/${relatedList}`, {
      query: { fields: fields?.join(","), page, per_page },
    });
  }
  addNote(module: string, id: string, title: string | undefined, content: string) {
    return this.request("POST", `/${module}/${id}/Notes`, {
      body: { data: [{ Note_Title: title, Note_Content: content }] },
    });
  }
}
