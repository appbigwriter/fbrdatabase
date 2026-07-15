import {
  resolveStorage,
  findBucket,
  authorizeRead,
  authorizeWrite,
  gateway,
  unauthorized,
  notFound
} from "../../../../../../lib/storage-route.js";

export const runtime = "nodejs";

export async function GET(request, { params }) {
  const bucketName = decodeURIComponent(params.bucket);
  const key = (params.path ?? []).map(encodeURIComponent).join("/");
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
  try {
    const result = await gateway().getObject(context.slug, bucketName, key);
    const headers = { "content-type": result.contentType };
    if (result.cacheControl) {
      headers["cache-control"] = result.cacheControl;
    }
    return new Response(result.body, { status: 200, headers });
  } catch {
    return notFound("Object not found");
  }
}

export async function POST(request, { params }) {
  const bucketName = decodeURIComponent(params.bucket);
  const key = (params.path ?? []).map(encodeURIComponent).join("/");
  const context = await resolveStorage(request);
  if (!context) {
    return notFound("Project not found for this host");
  }
  if (!authorizeWrite(context)) {
    return unauthorized("Write access denied");
  }
  const contentType = request.headers.get("content-type") ?? "application/octet-stream";
  const cacheControl = request.headers.get("x-upsert") === "true" ? undefined : request.headers.get("cache-control") ?? undefined;
  const body = Buffer.from(await request.arrayBuffer());
  const result = await gateway().putObject(context.slug, bucketName, key, body, contentType, cacheControl);
  return Response.json({ Id: result.path, Key: result.path, path: result.path }, { status: 200 });
}
