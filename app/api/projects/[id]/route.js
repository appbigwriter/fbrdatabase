import { NextResponse } from "next/server";
import { withAdminRoute } from "../../../../lib/admin-route.js";
import { deleteProject, getProjectDetail } from "../../../../lib/control-tower.js";

export const GET = withAdminRoute(async function GET(_request, { params }) {
  return NextResponse.json(await getProjectDetail(params.id));
});

export const DELETE = withAdminRoute(async function DELETE(request, { params }) {
  const { confirmation } = await request.json();
  return NextResponse.json(await deleteProject(params.id, confirmation));
});
