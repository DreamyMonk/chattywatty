import { clearAuthCookie, isPasswordValid, setAuthCookie } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { password?: string };

  if (!isPasswordValid(String(body.password ?? ""))) {
    return Response.json({ error: "Wrong password." }, { status: 401 });
  }

  await setAuthCookie();
  return Response.json({ ok: true });
}

export async function DELETE() {
  await clearAuthCookie();
  return Response.json({ ok: true });
}
