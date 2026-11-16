import http from 'node:http';
import { loadConfig } from './config.js';
import { createApp } from './app.js';
import { startJobs } from './jobs.js';

const config = loadConfig();
const app = createApp(config);

const server = http.createServer({ requestTimeout: 10_000, headersTimeout: 8_000, maxHeaderSize: 16 * 1024 }, app.handle);
server.keepAliveTimeout = 5_000;
server.maxRequestsPerSocket = 200;

if (config.jobs) startJobs(app);

server.listen(config.port, config.host, () => {
  console.log(`Rebel University listening on ${config.host}:${config.port} (${config.production ? 'production' : 'development'})`);
  if (!config.adminSecret) console.log('Admin page disabled: set ADMIN_SECRET (32+ characters) to enable it.');
  if (!config.smtp) console.log('Email notices disabled: set SMTP_HOST to enable them.');
});

const shutdown = () => {
  server.close(() => { app.store.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 5_000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
