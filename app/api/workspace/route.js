import { NextResponse } from "next/server";
import { withAdminRoute } from "../../../lib/admin-route.js";
import { getAdminWorkspace } from "../../../lib/control-tower.js";

export const GET = withAdminRoute(async function GET() {
  return NextResponse.json(await getAdminWorkspace());
});
