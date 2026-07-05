import { NextResponse } from "next/server";
import { withAdminRoute } from "../../../lib/admin-route.js";
import { listProjects, provisionProjectFromManifest } from "../../../lib/control-tower.js";

export const GET = withAdminRoute(async function GET() {
  return NextResponse.json(await listProjects());
});

export const POST = withAdminRoute(async function POST(request) {
  const manifest = await request.json();
  const project = await provisionProjectFromManifest(manifest);
  return NextResponse.json(project, { status: 201 });
});
