// PNN server entry: store + ingest + HTTP on config.port. SIM=1 replays saved samples.
import http from 'node:http';
import config from './config.mjs';
import { log, LOG_FILE } from './log.mjs';
import { createStore } from './store.mjs';
import { startIngest } from './ingest.mjs';
import { createHandler } from './app.mjs';

const sim = process.env.SIM === '1';

process.on('uncaughtException', (e) => log('error', 'uncaughtException', { error: String(e?.stack || e).slice(0, 2000) }));
process.on('unhandledRejection', (e) => log('error', 'unhandledRejection', { error: String(e?.stack || e).slice(0, 2000) }));

const store = createStore();
const server = http.createServer(createHandler(store, config));
server.keepAliveTimeout = 65_000;
server.requestTimeout = 0;        // SSE connections stay open

server.on('error', (e) => {
  log('error', 'server error', { error: String(e?.message || e), port: config.port });
  if (e?.code === 'EADDRINUSE') process.exit(1);
});

server.listen(config.port, () => {
  log('info', 'server start', { url: `http://localhost:${config.port}`, sim, pid: process.pid, logFile: LOG_FILE });
  startIngest(store, config, { sim });
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    log('info', 'server stop', { signal: sig, pid: process.pid });
    server.close();
    setTimeout(() => process.exit(0), 300).unref();
  });
}
