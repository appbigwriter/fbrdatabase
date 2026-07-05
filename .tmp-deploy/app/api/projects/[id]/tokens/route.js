import { NextResponse } from "next/server";
import { withAdminRoute } from "../../../../../lib/admin-route.js";
import { issueProjectToken } from "../../../../../lib/control-tower.js";

export const POST = withAdminRoute(async function POST(request, { params }) {
  const { scope, expiresAt, accessMode } = await request.json();
  return NextResponse.json(await issueProjectToken(params.id, scope, expiresAt, accessMode), { status: 201 });
});
