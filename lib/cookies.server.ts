import "server-only";

/** Read one cookie from a request; values are capped and decoded. */
export function readCookie(request: Request, name: string): string | null {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.split(";").map((c) => c.trim()).find((c) => c.startsWith(`${name}=`));
  if (!match) return null;
  try {
    return decodeURIComponent(match.slice(name.length + 1)).slice(0, 64);
  } catch {
    return null;
  }
}

export function boothRef(request: Request): string | null {
  const ref = readCookie(request, "kumbara_ref");
  return ref && /^[a-z0-9-]{1,64}$/i.test(ref) ? ref : null;
}
