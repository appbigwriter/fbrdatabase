import { NextResponse } from "next/server";
import { withAdminRoute } from "../../../../lib/admin-route.js";
import { verifyAuthIsolation } from "../../../../lib/control-tower.js";

export const POST = withAdminRoute(async function POST(request) {
  const { sourceProjectId, targetProjectId, email, password } = await request.json();
  return NextResponse.json(await verifyAuthIsolation(sourceProjectId, targetProjectId, email, password));
});
