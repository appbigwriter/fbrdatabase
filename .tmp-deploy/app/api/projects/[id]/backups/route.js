import { NextResponse } from "next/server";
import { withAdminRoute } from "../../../../../lib/admin-route.js";
import { createProjectBackup, listProjectBackups } from "../../../../../lib/control-tower.js";

export const GET = withAdminRoute(async function GET(_request, { params }) {
  return NextResponse.json(await listProjectBackups(params.id));
});

export const POST = withAdminRoute(async function POST(_request, { params }) {
  return NextResponse.json(await createProjectBackup(params.id), { status: 201 });
});
