import { resolveStorageContext, getStorageGateway } from "./control-tower.js";

export async function resolveStorage(request) {
  const host = request.headers.get("host") ?? "";
  const apiKey = request.headers.get("apikey") ?? "";
  const authHeader = request.headers.get("authorization") ?? "";
  const context = await resolveStorageContext(host, authHeader, apiKey);
  return context;
}

export function findBucket(context, bucketName) {
  return context.buckets.find((bucket) => bucket.name === bucketName) ?? null;
}

export function authorizeRead(context, bucket) {
  if (bucket?.visibility === "public") {
    return true;
  }
  return context.role === "service_role" || context.role === "authenticated";
}

export function authorizeWrite(context) {
  return context.role === "service_role" || context.role === "authenticated";
}

export function gateway() {
  return getStorageGateway();
}

export function unauthorized(message = "Unauthorized") {
  return new Response(JSON.stringify({ statusCode: "401", error: message, message }), {
    status: 401,
    headers: { "content-type": "application/json" }
  });
}

export function notFound(message = "Not found") {
  return new Response(JSON.stringify({ statusCode: "404", error: message, message }), {
    status: 404,
    headers: { "content-type": "application/json" }
  });
}
