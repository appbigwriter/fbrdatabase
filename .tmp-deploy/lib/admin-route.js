import { NextResponse } from "next/server";
import { AdminUnauthorizedError, requireAdminApiSession } from "./admin-auth.js";

export function withAdminRoute(handler) {
  return async function guardedRoute(request, context) {
    try {
      await requireAdminApiSession();
      return await handler(request, context);
    } catch (error) {
      if (error instanceof AdminUnauthorizedError) {
        return NextResponse.json({ error: error.message }, { status: 401 });
      }

      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Unexpected route failure" },
        { status: 500 }
      );
    }
  };
}
