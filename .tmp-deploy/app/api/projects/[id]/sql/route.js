import { NextResponse } from "next/server";
import { withAdminRoute } from "../../../../../lib/admin-route.js";
import { runProjectSql } from "../../../../../lib/control-tower.js";

export const POST = withAdminRoute(async function POST(request, { params }) {
  const { sql } = await request.json();
  return NextResponse.json(await runProjectSql(params.id, sql));
});
