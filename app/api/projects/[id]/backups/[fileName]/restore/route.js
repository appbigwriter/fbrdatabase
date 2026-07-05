import { NextResponse } from "next/server";
import { withAdminRoute } from "../../../../../../../lib/admin-route.js";
import { restoreProjectBackup } from "../../../../../../../lib/control-tower.js";

export const POST = withAdminRoute(async function POST(_request, { params }) {
  return NextResponse.json(await restoreProjectBackup(params.id, params.fileName));
});
