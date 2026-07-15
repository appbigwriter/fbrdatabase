import { resolveStorage, findBucket, authorizeRead, gateway, unauthorized, notFound } from "../../../../../../lib/storage-route.js";

export const runtime = "nodejs";

export async function POST(request, { params }) {
  const bucketName = decodeURIComponent(params.bucket);
  const context = await resolveStorage(request);
  if (!context) {
    return notFound("Project not found for this host");
  }
  const bucket = findBucket(context, bucketName);
  if (!bucket) {
    return notFound("Bucket not found");
  }
  if (!authorizeRead(context, bucket)) {
    return unauthorized("Read access denied for this bucket");
  }
  const body = await request.json().catch(() => ({}));
  const prefix = String(body.prefix ?? "");
  const limit = Number(body.limit ?? 100);
  const offset = Number(body.offset ?? 0);
  const objects = await gateway().listObjects(context.slug, bucketName, { prefix, limit, offset });
  return Response.json(objects, { status: 200 });
}
