// What a job application needs from the candidate before ApplyPilot may send it to the laptop.
// Pure functions, so the rules are easy to read and to check. The desktop engine fills the same fields.

// Identity details almost every application form asks for, with the profile key that holds each one.
export const IDENTITY_FIELDS = [
  { key: 'firstName', label: 'First name' },
  { key: 'lastName', label: 'Last name' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'phone', label: 'Phone number', type: 'tel' },
  { key: 'city', label: 'City' },
  { key: 'country', label: 'Country' },
];

const filled = (v) => String(v == null ? '' : v).trim().length > 0;

// Profile fields that are still empty. The phone number is optional for a few boards but always asked for.
export function missingIdentity(profile = {}) {
  return IDENTITY_FIELDS.filter((f) => !filled(profile[f.key]));
}

// Everything the desktop needs before it can fill the form: identity details and a resume.
export function readiness(profile = {}, resume = null) {
  const missing = missingIdentity(profile);
  return { missing, resumeOk: !!resume, ready: missing.length === 0 && !!resume };
}

// The address line a form's single "Address" box expects ("Hyderabad, India").
export function addressLine(profile = {}) {
  return [profile.city, profile.country].filter(filled).map((x) => String(x).trim()).join(', ');
}
