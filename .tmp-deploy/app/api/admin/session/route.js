import { NextResponse } from "next/server";
import {
  authenticateAdmin,
  buildClearedSessionCookie,
  buildSessionCookie,
  createAdminSessionToken
} from "../../../../lib/admin-auth.js";

export async function POST(request) {
  try {
    const { email, password } = await request.json();
    const session = await authenticateAdmin(email, password);
    const response = NextResponse.json({ ok: true, email: session.email });
    response.cookies.set(buildSessionCookie(createAdminSessionToken(session)));
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao autenticar admin." },
      { status: 401 }
    );
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(buildClearedSessionCookie());
  return response;
}
