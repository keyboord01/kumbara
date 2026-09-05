/** The browser reports the passkey-signed vault deposit (arrival autopilot). */
import { NextResponse } from "next/server";
import { recordVaultDeposit } from "@/lib/deposit.server";
import { depositErrorResponse } from "../../route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readCookie(request: Request, name: string): string | null {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.split(";").map((c) => c.trim()).find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)).slice(0, 64) : null;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  let body: { hash?: string; amountUsdc?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "invalid JSON" } }, { status: 400 });
  }
  try {
    const record = await recordVaultDeposit(id, { hash: String(body.hash ?? ""), amountUsdc: String(body.amountUsdc ?? ""), ref: readCookie(request, "kumbara_ref") });
    return NextResponse.json(record, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return depositErrorResponse(err);
  }
}
