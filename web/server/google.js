// Google ID-token verification (Google Identity Services "credential", or the ID token returned by the
// native Google Sign-In SDKs inside the iOS/Android apps).
import { OAuth2Client } from 'google-auth-library';

const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

/**
 * Default verifier: async (idToken, audiences: string[]) => payload.
 * google-auth-library's verifyIdToken checks the RS256 signature against Google's published certs,
 * plus `aud` (must be one of the allow-listed client ids), `iss` and `exp`. Tests inject a stand-in.
 */
export function createGoogleVerifier() {
  const client = new OAuth2Client();
  return async (idToken, audience) => {
    const ticket = await client.verifyIdToken({ idToken, audience });
    return ticket.getPayload();
  };
}

/**
 * Defensive re-checks on the verified payload; returns the profile we keep. Throws on anything off.
 * @param {object} p  verified payload
 * @param {string|string[]} clientIds  exact-match allow-list of accepted audiences (web, Android, iOS)
 */
export function profileFromPayload(p, clientIds) {
  const allowed = new Set((Array.isArray(clientIds) ? clientIds : [clientIds]).filter(Boolean));
  if (!p || typeof p !== 'object') throw new Error('Empty token payload');
  if (!ISSUERS.has(p.iss)) throw new Error('Wrong token issuer');
  const aud = Array.isArray(p.aud) ? p.aud : [p.aud];
  if (!aud.length || !aud.every((a) => typeof a === 'string' && allowed.has(a))) throw new Error('Wrong token audience');
  if (typeof p.exp !== 'number' || p.exp * 1000 < Date.now() - 5 * 60 * 1000) throw new Error('Token expired');
  if (typeof p.sub !== 'string' || !p.sub || typeof p.email !== 'string' || !p.email) throw new Error('Token is missing subject or email');
  if (p.email_verified !== true && p.email_verified !== 'true') throw new Error('Google email is not verified');
  return { sub: p.sub, email: p.email, name: typeof p.name === 'string' ? p.name : '', picture: typeof p.picture === 'string' ? p.picture : '' };
}
