import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const ADMIN_SESSION_COOKIE = "control_tower_admin_session";

const SESSION_TTL_MS = 1000 * 60 * 60 * 12;

export class AdminUnauthorizedError extends Error {
  constructor(message = "Admin authentication required") {
    super(message);
    this.name = "AdminUnauthorizedError";
  }
}

export function getAdminAuthConfig(env = process.env) {
  const bootstrapEmail = (env.CONTROL_TOWER_ADMIN_BOOTSTRAP_EMAIL ?? "").trim().toLowerCase();
  const allowedEmails = String(env.CONTROL_TOWER_ADMIN_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (allowedEmails.length === 0 && bootstrapEmail) {
    allowedEmails.push(bootstrapEmail);
  }

  const fallbackSupabaseUrl = trimTrailingSlash(env.SUPABASE_URL);
  const fallbackSupabaseKey = env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_ANON_KEY ?? "";

  const sessionSecret = env.CONTROL_TOWER_ADMIN_SESSION_SECRET ?? "";
  if (env.NODE_ENV === "production" && (!sessionSecret || sessionSecret === "change-me-in-production")) {
    throw new Error("CONTROL_TOWER_ADMIN_SESSION_SECRET must be configured with a strong non-default value in production.");
  }

  return {
    allowedEmails,
    authUrl: trimTrailingSlash(env.CONTROL_TOWER_ADMIN_AUTH_URL) || fallbackSupabaseUrl,
    authApiKey: env.CONTROL_TOWER_ADMIN_AUTH_API_KEY ?? fallbackSupabaseKey,
    bootstrapEmail,
    bootstrapPassword: env.CONTROL_TOWER_ADMIN_BOOTSTRAP_PASSWORD ?? "",
    sessionSecret: sessionSecret || "change-me-in-production",
    providerLabel: trimTrailingSlash(env.CONTROL_TOWER_ADMIN_AUTH_URL) ? "dedicated-gotrue" : fallbackSupabaseUrl ? "supabase-fallback" : "bootstrap"
  };
}

export async function authenticateAdmin(email, password) {
  const normalizedEmail = String(email ?? "").trim().toLowerCase();
  const normalizedPassword = String(password ?? "");
  const config = getAdminAuthConfig();

  if (!normalizedEmail || !normalizedPassword) {
    throw new AdminUnauthorizedError("Informe email e senha.");
  }

  if (!config.allowedEmails.includes(normalizedEmail)) {
    throw new AdminUnauthorizedError("Este email nao esta autorizado para o painel.");
  }

  if (config.bootstrapEmail && config.bootstrapPassword) {
    const emailOk = timingSafeEqual(normalizedEmail, config.bootstrapEmail);
    const passwordOk = timingSafeEqual(normalizedPassword, config.bootstrapPassword);
    if (emailOk && passwordOk) {
      return {
        email: normalizedEmail,
        provider: "bootstrap"
      };
    }
  }

  if (config.authUrl) {
    const response = await fetch(`${config.authUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.authApiKey ? { apikey: config.authApiKey } : {})
      },
      body: JSON.stringify({
        email: normalizedEmail,
        password: normalizedPassword
      })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new AdminUnauthorizedError(payload.msg ?? payload.error_description ?? "Credenciais invalidas.");
    }

    const providerEmail = String(payload.user?.email ?? normalizedEmail).trim().toLowerCase();
    if (!config.allowedEmails.includes(providerEmail)) {
      throw new AdminUnauthorizedError("Conta autenticada, mas fora da allowlist do painel.");
    }

    return {
      email: providerEmail,
      provider: "gotrue"
    };
  }

  throw new AdminUnauthorizedError("Credenciais invalidas.");
}

export function createAdminSessionToken(session) {
  const config = getAdminAuthConfig();
  const payload = {
    email: session.email,
    provider: session.provider,
    exp: Date.now() + SESSION_TTL_MS
  };
  const body = encodeBase64Url(JSON.stringify(payload));
  const signature = sign(body, config.sessionSecret);
  return `${body}.${signature}`;
}

export function readAdminSessionToken(token) {
  if (!token || typeof token !== "string") {
    return null;
  }

  const config = getAdminAuthConfig();
  const [body, signature] = token.split(".");
  if (!body || !signature) {
    return null;
  }

  const expectedSignature = sign(body, config.sessionSecret);
  if (!timingSafeEqual(signature, expectedSignature)) {
    return null;
  }

  try {
    const payload = JSON.parse(decodeBase64Url(body));
    if (!payload?.email || !payload?.exp || payload.exp < Date.now()) {
      return null;
    }
    if (!config.allowedEmails.includes(String(payload.email).toLowerCase())) {
      return null;
    }
    return {
      email: String(payload.email).toLowerCase(),
      provider: payload.provider === "gotrue" ? "gotrue" : "bootstrap",
      expiresAt: new Date(payload.exp).toISOString()
    };
  } catch {
    return null;
  }
}

export async function getAdminSession() {
  const cookieStore = await cookies();
  return readAdminSessionToken(cookieStore.get(ADMIN_SESSION_COOKIE)?.value ?? "");
}

export async function requireAdminPageSession() {
  const session = await getAdminSession();
  if (!session) {
    redirect("/login");
  }
  return session;
}

export async function requireAdminApiSession() {
  const session = await getAdminSession();
  if (!session) {
    throw new AdminUnauthorizedError();
  }
  return session;
}

export function buildSessionCookie(token) {
  return {
    name: ADMIN_SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000)
  };
}

export function buildClearedSessionCookie() {
  return {
    name: ADMIN_SESSION_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0
  };
}

function sign(value, secret) {
  return encodeBase64Url(crypto.createHmac("sha256", secret).update(value).digest());
}

function encodeBase64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function decodeBase64Url(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function trimTrailingSlash(value) {
  return value ? String(value).replace(/\/+$/, "") : "";
}

function timingSafeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
