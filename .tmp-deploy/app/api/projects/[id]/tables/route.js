import { NextResponse } from "next/server";
import { withAdminRoute } from "../../../../../lib/admin-route.js";
import { listProjectTables } from "../../../../../lib/control-tower.js";

export const GET = withAdminRoute(async function GET(request, { params }) {
  const { searchParams } = new URL(request.url);
  const filter = searchParams.get("filter") ?? "";
  return NextResponse.json(await listProjectTables(params.id, filter));
});
