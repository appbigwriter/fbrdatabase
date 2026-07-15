import { resolveStorage, unauthorized, notFound } from "../../../../lib/storage-route.js";

export const runtime = "nodejs";

export async function GET(request) {
  const context = await resolveStorage(request);
  if (!context) {
    return notFound("Project not found for this host");
  }
  if (!context.role) {
    return unauthorized("A valid API key is required");
  }
  const buckets = context.buckets.map((bucket) => ({
    id: bucket.name,
    name: bucket.name,
    owner: "",
    created_at: bucket.createdAt,
    updated_at: bucket.createdAt,
    public: bucket.visibility === "public"
  }));
  return Response.json(buckets, { status: 200 });
}
