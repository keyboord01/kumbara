/**
 * Browser-side fetch wrapper for Kumbara's own API routes. Every failure
 * becomes an ApiError with a stable `code`, so screens can classify it
 * (lib/failures.ts) instead of showing raw text:
 *
 *   offline / unreachable   the request never got an answer
 *   deployment_protected    Vercel's login page came back instead of JSON
 *                           (deployment protection was re-enabled)
 *   <route error code>      the route's own { error: { code, message } }
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly source?: string,
    readonly errorCode?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function looksLikeVercelLogin(res: Response, text: string): boolean {
  const type = res.headers.get("content-type") ?? "";
  if (/vercel\.com\/sso|vercel\.com\/login/.test(res.url)) return true;
  if (!type.includes("text/html")) return false;
  return res.status === 401 || res.status === 403 || /Authentication Required|_vercel_sso|sso-api|vercel/i.test(text.slice(0, 4000));
}

type ApiBody<T> = (T & { error?: { code?: string; message?: string; source?: string } | string; errorCode?: string }) | null;

function parseBody<T>(text: string): ApiBody<T> {
  return text ? (JSON.parse(text) as ApiBody<T>) : null;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  } catch (err) {
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    throw new ApiError(0, offline ? "offline" : "unreachable", err instanceof Error ? err.message : String(err));
  }
  const text = await res.text();
  if (looksLikeVercelLogin(res, text)) {
    throw new ApiError(res.status, "deployment_protected", `HTTP ${res.status} with an HTML login page from ${res.url}`);
  }
  let body: ApiBody<T>;
  try {
    body = parseBody<T>(text);
  } catch {
    throw new ApiError(res.status, res.ok ? "invalid_response" : "http_error", `HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    const error = body?.error;
    const message = (typeof error === "object" && error?.message) || (typeof error === "string" ? error : undefined) || `HTTP ${res.status}`;
    const code = (typeof error === "object" && error?.code) || body?.errorCode || `http_${res.status}`;
    throw new ApiError(res.status, code, message, typeof error === "object" ? error?.source : undefined, body?.errorCode);
  }
  return body as T;
}
