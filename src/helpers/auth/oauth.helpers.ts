import { createPublicKey, verify as verifySignature } from "node:crypto";
import { createAppError } from "../../utils/AppError.js";

export interface GoogleClaims {
  sub: string;
  email: string;
  email_verified: boolean;
  given_name?: string;
  family_name?: string;
  picture?: string;
}

export interface MicrosoftClaims {
  oid: string;
  tid?: string;
  email: string;
  email_verified: boolean;
  given_name?: string;
  family_name?: string;
  preferred_username?: string;
}

function decodePart(value: string) {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
}

export async function verifyGoogleIdToken(idToken: string): Promise<GoogleClaims> {
  let response: Response;
  try {
    response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
  } catch {
    throw createAppError(503, "OAUTH_PROVIDER_UNAVAILABLE", "Google sign-in could not reach Google's verification service.", true);
  }
  if (!response.ok) throw createAppError(401, "OAUTH_TOKEN_INVALID", "Google rejected the sign-in token. Check the OAuth client ID and authorized origin.");
  let claims: Record<string, string>;
  try {
    claims = await response.json() as Record<string, string>;
  } catch {
    throw createAppError(401, "OAUTH_TOKEN_INVALID", "Google returned an invalid sign-in token.");
  }
  if (claims.aud !== process.env.GOOGLE_CLIENT_ID || claims.email_verified !== "true" || !claims.sub || !claims.email) {
    throw createAppError(401, "OAUTH_TOKEN_INVALID", "The Google sign-in token does not match this app's client ID.");
  }
  return {
    sub: claims.sub,
    email: claims.email.toLowerCase(),
    email_verified: true,
    given_name: claims.given_name,
    family_name: claims.family_name,
    picture: claims.picture,
  };
}

export async function verifyMicrosoftIdToken(idToken: string): Promise<MicrosoftClaims> {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("Microsoft token format is invalid.");
  const header = decodePart(parts[0]);
  const claims = decodePart(parts[1]);
  if (header.alg !== "RS256" || typeof header.kid !== "string") throw new Error("Microsoft token algorithm is invalid.");
  if (typeof claims.exp !== "number" || claims.exp <= Math.floor(Date.now() / 1000)) throw new Error("Microsoft token has expired.");
  if (claims.aud !== process.env.MICROSOFT_CLIENT_ID || typeof claims.oid !== "string") throw new Error("Microsoft token audience is invalid.");

  const tenantId = process.env.MICROSOFT_TENANT_ID || "common";
  let metadata: { jwks_uri: string; issuer: string };
  let jwks: { keys: Array<Record<string, unknown>> };
  try {
    const response = await fetch(`https://login.microsoftonline.com/${tenantId}/v2.0/.well-known/openid-configuration`);
    if (!response.ok) throw new Error("metadata unavailable");
    metadata = await response.json() as { jwks_uri: string; issuer: string };
    const keyResponse = await fetch(metadata.jwks_uri);
    if (!keyResponse.ok) throw new Error("signing keys unavailable");
    jwks = await keyResponse.json() as { keys: Array<Record<string, unknown>> };
  } catch {
    throw createAppError(503, "OAUTH_PROVIDER_UNAVAILABLE", "Microsoft sign-in could not reach its verification service.", true);
  }
  const jwk = jwks.keys.find((key) => key.kid === header.kid);
  if (!jwk) throw new Error("Microsoft signing key was not found.");
  const valid = verifySignature(null, Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(parts[2], "base64url"));
  const expectedIssuer = metadata.issuer.replace("{tenantid}", typeof claims.tid === "string" ? claims.tid : "");
  if (!valid || claims.iss !== expectedIssuer) throw new Error("Microsoft token signature is invalid.");

  const email = (typeof claims.email === "string" && claims.email) || (typeof claims.preferred_username === "string" && claims.preferred_username);
  if (!email) throw new Error("Microsoft token does not contain an email.");
  return {
    oid: claims.oid,
    tid: typeof claims.tid === "string" ? claims.tid : undefined,
    email: email.toLowerCase(),
    email_verified: true,
    given_name: typeof claims.given_name === "string" ? claims.given_name : undefined,
    family_name: typeof claims.family_name === "string" ? claims.family_name : undefined,
    preferred_username: typeof claims.preferred_username === "string" ? claims.preferred_username : undefined,
  };
}
