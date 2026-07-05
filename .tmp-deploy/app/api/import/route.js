import { NextResponse } from "next/server";
import { withAdminRoute } from "../../../lib/admin-route.js";
import { importSupabaseProject } from "../../../lib/control-tower.js";

export const POST = withAdminRoute(async function POST(request) {
  const payload = await request.json();
  return NextResponse.json(await importSupabaseProject(payload), { status: 201 });
});
