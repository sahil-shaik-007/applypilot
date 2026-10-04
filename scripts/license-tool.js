#!/usr/bin/env node
// Seller-side license tool. NEVER ship the private key.
//   node scripts/license-tool.js init                         -> creates keys/license-private.pem + electron/license-public.pem
//   node scripts/license-tool.js issue <email> [pro|lifetime] [days]   -> prints a license key
//   node scripts/license-tool.js verify <key>
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { signKey, verifyKey } = require('../electron/license');

const root = path.join(__dirname, '..');
const privPath = path.join(root, 'keys', 'license-private.pem');
const pubPath = path.join(root, 'electron', 'license-public.pem');
const [cmd, ...args] = process.argv.slice(2);

if (cmd === 'init') {
  if (fs.existsSync(privPath)) { console.log('Keys already exist at', privPath, '(delete them first to rotate — this invalidates all issued keys).'); process.exit(0); }
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  fs.mkdirSync(path.dirname(privPath), { recursive: true });
  fs.writeFileSync(privPath, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  fs.writeFileSync(pubPath, publicKey.export({ type: 'spki', format: 'pem' }));
  console.log('Created', privPath, '(keep secret & backed up!) and', pubPath);
} else if (cmd === 'issue') {
  const [email, plan = 'pro', days] = args;
  if (!email) { console.error('usage: issue <email> [pro|lifetime] [days]'); process.exit(1); }
  const payload = { id: crypto.randomUUID().slice(0, 8), email, plan, iat: new Date().toISOString() };
  if (days) payload.exp = new Date(Date.now() + Number(days) * 86400000).toISOString();
  else if (plan === 'pro') payload.exp = new Date(Date.now() + 31 * 86400000).toISOString();
  console.log(signKey(fs.readFileSync(privPath, 'utf8'), payload));
} else if (cmd === 'verify') {
  console.log(verifyKey(args[0]));
} else {
  console.log('commands: init | issue <email> [pro|lifetime] [days] | verify <key>');
}
