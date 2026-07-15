import { resolveStorage, authorizeWrite, gateway, unauthorized, notFound } from "../../../../../lib/storage-route.js";

export const runtime = "nodejs";

export async function DELETE(request, { params }) {
  const bucketName = decodeURIComponent(params.bucket);
  const context = await resolveStorage(request);
  if (!context) {
    return notFound("Project not found for this host");
  }
  if (!authorizeWrite(context)) {
    return unauthorized("Write access denied");
  }
  const body = await request.json().catch(() => ({}));
  const prefixes = Array.isArray(body.prefixes) ? body.prefixes.map(String) : [];
  await gateway().removeObjects(context.slug, bucketName, prefixes);
  return Response.json({ message: "deleted" }, { status: 200 });
}
