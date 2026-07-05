import { NextResponse } from "next/server";
import { withAdminRoute } from "../../../../../lib/admin-route.js";
import { createProjectBucket, getProjectDetail } from "../../../../../lib/control-tower.js";

export const GET = withAdminRoute(async function GET(_request, { params }) {
  const detail = await getProjectDetail(params.id);
  return NextResponse.json(detail.buckets);
});

export const POST = withAdminRoute(async function POST(request, { params }) {
  const { name, visibility, backend } = await request.json();
  return NextResponse.json(await createProjectBucket(params.id, name, visibility, backend), { status: 201 });
});
