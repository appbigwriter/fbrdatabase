import crypto from "node:crypto";

export type SupabaseKeyRole = "anon" | "service_role";

export interface SupabaseApiKey {
  role: SupabaseKeyRole;
  token: string;
}

export interface SupabaseKeySet {
  anonKey: string;
  serviceRoleKey: string;
}

const JWT_HEADER = { alg: "HS256", typ: "JWT" };

export function signJwt(payload: Record<string, unknown>, secret: string): string {
  const encodedHeader = encodeBase64Url(JSON.stringify(JWT_HEADER));
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto.createHmac("sha256", secret).update(signingInput).digest("base64url");
  return `${signingInput}.${signature}`;
}

export function verifyJwt(token: string, secret: string): Record<string, unknown> | null {
  const parts = String(token ?? "").split(".");
  if (parts.length !== 3) {
    return null;
  }
  const [header, payload, signature] = parts;
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(`${header}.${payload}`)
    .digest("base64url");
  if (!timingSafeEqual(signature, expectedSignature)) {
    return null;
  }
  try {
    const decoded = JSON.parse(decodeBase64Url(payload)) as Record<string, unknown>;
    const exp = decoded.exp;
    if (typeof exp === "number" && Date.now() >= exp * 1000) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

export function createSupabaseApiKey(
  role: SupabaseKeyRole,
  jwtSecret: string,
  projectRef: string,
  issuedAt: Date = new Date()
): SupabaseApiKey {
  const payload = {
    role,
    iss: "supabase",
    ref: projectRef,
    iat: Math.floor(issuedAt.getTime() / 1000)
  };
  return { role, token: signJwt(payload, jwtSecret) };
}

export function createSupabaseKeySet(
  jwtSecret: string,
  projectRef: string,
  issuedAt: Date = new Date()
): SupabaseKeySet {
  return {
    anonKey: createSupabaseApiKey("anon", jwtSecret, projectRef, issuedAt).token,
    serviceRoleKey: createSupabaseApiKey("service_role", jwtSecret, projectRef, issuedAt).token
  };
}

export function generateJwtSecret(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function timingSafeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
