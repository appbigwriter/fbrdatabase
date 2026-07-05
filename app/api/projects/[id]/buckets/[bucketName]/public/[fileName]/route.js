import { NextResponse } from "next/server";
import { readBucketFile } from "../../../../../../../../lib/control-tower.js";

export async function GET(_request, { params }) {
  try {
    const file = await readBucketFile(params.id, params.bucketName, params.fileName);
    return new NextResponse(file.content, {
      status: 200,
      headers: {
        "Content-Type": contentTypeFor(file.name),
        "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
        ETag: `"${file.modifiedAt}"`
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Bucket file not found." },
      { status: 404 }
    );
  }
}

function contentTypeFor(fileName) {
  const lower = String(fileName).toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}
