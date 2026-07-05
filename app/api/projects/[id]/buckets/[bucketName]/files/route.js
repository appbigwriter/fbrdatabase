import { NextResponse } from "next/server";
import { withAdminRoute } from "../../../../../../../lib/admin-route.js";
import { listBucketFiles, saveBucketFile } from "../../../../../../../lib/control-tower.js";

export const GET = withAdminRoute(async function GET(_request, { params }) {
  return NextResponse.json(await listBucketFiles(params.id, params.bucketName));
});

export const POST = withAdminRoute(async function POST(request, { params }) {
  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }
  const saved = await saveBucketFile(params.id, params.bucketName, file.name, await file.arrayBuffer());
  return NextResponse.json(saved, { status: 201 });
});
