// Google ID-token verification (Google Identity Services "credential").
import { OAuth2Client } from 'google-auth-library';

const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

/**
 * Default verifier: async (idToken, audience) => payload.
 * google-auth-library's verifyIdToken checks the RS256 signature against Google's published certs,
 * plus `aud`, `iss` and `exp`. Tests inject a stand-in with the same signature.
 */
export function createGoogleVerifier() {
  const client = new OAuth2Client();
  return async (idToken, audience) => {
    const ticket = await client.verifyIdToken({ idToken, audience });
    return ticket.getPayload();
  };
}

/** Defensive re-checks on the verified payload; returns the profile we keep. Throws on anything off. */
export function profileFromPayload(p, clientId) {
  if (!p || typeof p !== 'object') throw new Error('Empty token payload');
  if (!ISSUERS.has(p.iss)) throw new Error('Wrong token issuer');
  const aud = Array.isArray(p.aud) ? p.aud : [p.aud];
  if (!aud.includes(clientId)) throw new Error('Wrong token audience');
  if (typeof p.exp !== 'number' || p.exp * 1000 < Date.now() - 5 * 60 * 1000) throw new Error('Token expired');
  if (typeof p.sub !== 'string' || !p.sub || typeof p.email !== 'string' || !p.email) throw new Error('Token is missing subject or email');
  if (p.email_verified !== true && p.email_verified !== 'true') throw new Error('Google email is not verified');
  return { sub: p.sub, email: p.email, name: typeof p.name === 'string' ? p.name : '', picture: typeof p.picture === 'string' ? p.picture : '' };
}
