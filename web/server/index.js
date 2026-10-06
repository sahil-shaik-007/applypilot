// ApplyPilot Cloud server entry point.
//   node server/index.js               (development defaults)
//   node server/index.js --production  (same as NODE_ENV=production; used by `npm start`)
if (process.argv.includes('--production')) process.env.NODE_ENV = 'production';

const { loadConfig } = await import('./config.js');
const { startServer } = await import('./app.js');

let config;
try {
  config = loadConfig(process.env);
} catch (e) {
  console.error(`[applypilot-cloud] ${e.message}`);
  process.exit(1);
}

if (config.production && !config.googleClientId) {
  console.warn('[applypilot-cloud] GOOGLE_CLIENT_ID is not set: nobody will be able to sign in.');
}
if (config.devLogin) {
  console.warn('[applypilot-cloud] DEV LOGIN ENABLED (AP_DEV_LOGIN=1). Anyone can sign in as any email. Never use outside local development.');
}

const running = await startServer(config);
console.log(`[applypilot-cloud] v${config.version} listening on :${running.port} (${config.production ? 'production' : 'development'}), app origin ${config.appOrigin}`);

let stopping = false;
const shutdown = async (sig) => {
  if (stopping) return;
  stopping = true;
  console.log(`[applypilot-cloud] ${sig} received, shutting down`);
  const t = setTimeout(() => process.exit(0), 5000);
  t.unref();
  await running.close();
  process.exit(0);
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
