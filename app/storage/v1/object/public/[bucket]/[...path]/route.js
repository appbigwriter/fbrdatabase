import { resolveStorage, findBucket, gateway, notFound } from "../../../../../../../lib/storage-route.js";

export const runtime = "nodejs";

export async function GET(request, { params }) {
  const bucketName = decodeURIComponent(params.bucket);
  const key = (params.path ?? []).map(encodeURIComponent).join("/");
  const host = request.headers.get("host") ?? "";
  const context = await resolveStorage(request);
  if (!context) {
    return notFound("Project not found for this host");
  }
  const bucket = findBucket(context, bucketName);
  if (!bucket || bucket.visibility !== "public") {
    return notFound("Public bucket not found");
  }
  try {
    const result = await gateway().getObject(context.slug, bucketName, key);
    const headers = { "content-type": result.contentType, "cache-control": "public, max-age=3600" };
    return new Response(result.body, { status: 200, headers });
  } catch {
    return notFound("Object not found");
  }
}
