/**
 * tests/proxy.test.ts — Mock proxy tests (v0.3.0 RC2)
 *
 * Tests EnvHttpProxyAgent integration via local mock servers.
 * The mock proxy handles HTTP CONNECT tunnelling by using a raw TCP server.
 */
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { connect, type Socket } from 'node:net';
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { EnvHttpProxyAgent, getGlobalDispatcher, request } from 'undici';
import { setupProxy, teardownProxy, getProxyStatus } from '../src/network/proxy.js';

const SAVED_ENV: Record<string, string | undefined> = {};

function cleanupEnv(): void {
  for (const key of ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'NO_PROXY', 'no_proxy']) {
    delete process.env[key];
  }
}

describe('Environment proxy support', () => {
  let targetServer: Server;
  let targetPort: number;
  let proxyServer: net.Server;
  let proxyPort: number;
  let proxyConnectCount: number;

  before(async () => {
    for (const key of ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'NO_PROXY', 'no_proxy']) {
      SAVED_ENV[key] = process.env[key];
    }

    // Target server
    await new Promise<void>((resolve) => {
      targetServer = createServer((_req: IncomingMessage, res: ServerResponse) => {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('from-target');
      });
      targetServer.listen(0, () => {
        targetPort = (targetServer.address() as import('net').AddressInfo).port;
        resolve();
      });
    });

    // Proxy server — raw TCP, handles CONNECT
    proxyConnectCount = 0;
    await new Promise<void>((resolve) => {
      proxyServer = net.createServer((clientSocket: Socket) => {
        let data = '';
        clientSocket.once('data', (chunk) => {
          data += chunk.toString();
          if (data.startsWith('CONNECT')) {
            proxyConnectCount++;
            // Parse CONNECT target
            const match = data.match(/CONNECT\s+([^:\s]+):(\d+)/);
            if (!match) {
              clientSocket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
              clientSocket.end();
              return;
            }
            const host = match[1]!;
            const port = parseInt(match[2]!, 10);

            // Connect to target and establish tunnel
            const targetSock = connect(port, host, () => {
              // Tell client the tunnel is established
              clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
              // Pipe both directions
              clientSocket.pipe(targetSock);
              targetSock.pipe(clientSocket);
            });
            targetSock.on('error', () => clientSocket.end());
            clientSocket.on('error', () => targetSock.end());
          } else {
            // Not CONNECT — respond directly for the rest of the data
            clientSocket.write('HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 15\r\n\r\nproxy-intercept');
            clientSocket.end();
          }
        });
        clientSocket.on('error', () => {});
      });
      proxyServer.listen(0, () => {
        proxyPort = (proxyServer.address() as import('net').AddressInfo).port;
        resolve();
      });
    });
  });

  beforeEach(() => {
    cleanupEnv();
    teardownProxy();
    proxyConnectCount = 0;
  });

  after(() => {
    targetServer?.close();
    proxyServer?.close();
    teardownProxy();
    for (const key of Object.keys(SAVED_ENV)) {
      if (SAVED_ENV[key] === undefined) delete process.env[key];
      else process.env[key] = SAVED_ENV[key];
    }
  });

  // ── Status API ────────────────────────────────────

  it('no proxy env vars → disabled', () => {
    assert.equal(getProxyStatus().detected, false);
    assert.equal(getProxyStatus().enabled, false);
  });

  it('HTTP_PROXY set → detected before setup', () => {
    process.env.HTTP_PROXY = `http://localhost:${proxyPort}`;
    assert.equal(getProxyStatus().detected, true);
    assert.equal(getProxyStatus().enabled, false);
  });

  it('lowercase http_proxy → detected', () => {
    process.env.http_proxy = `http://localhost:${proxyPort}`;
    assert.equal(getProxyStatus().detected, true);
    assert.equal(getProxyStatus().hostname, `http://localhost:${proxyPort}`);
  });

  it('setup activates proxy', () => {
    process.env.HTTP_PROXY = `http://localhost:${proxyPort}`;
    setupProxy();
    assert.equal(getProxyStatus().enabled, true);
    assert.equal(getProxyStatus().source, 'HTTP_PROXY');
    assert.ok(getProxyStatus().hostname?.includes(`localhost:${proxyPort}`));
  });

  it('setup prefers HTTPS_PROXY over HTTP_PROXY', () => {
    process.env.HTTP_PROXY = `http://localhost:9999`;
    process.env.HTTPS_PROXY = `http://localhost:${proxyPort}`;
    setupProxy();
    assert.equal(getProxyStatus().source, 'HTTPS_PROXY');
  });

  it('setup without env vars is no-op', () => {
    setupProxy();
    assert.equal(getProxyStatus().enabled, false);
  });

  it('teardown proxy disables active state', () => {
    process.env.HTTP_PROXY = `http://localhost:${proxyPort}`;
    setupProxy();
    assert.equal(getProxyStatus().enabled, true);
    teardownProxy();
    assert.equal(getProxyStatus().enabled, false);
  });

  it('multiple setup calls are idempotent', () => {
    process.env.HTTP_PROXY = `http://localhost:${proxyPort}`;
    setupProxy();
    setupProxy();
    assert.equal(getProxyStatus().enabled, true);
  });

  // ── Global dispatcher change ──────────────────────

  it('setupProxy changes the global dispatcher then restores on teardown', () => {
    const before = getGlobalDispatcher();
    process.env.HTTP_PROXY = `http://localhost:${proxyPort}`;
    setupProxy();
    const after = getGlobalDispatcher();
    assert.notEqual(after, before, 'Global dispatcher changes after setupProxy');
    teardownProxy();
    const restored = getGlobalDispatcher();
    assert.equal(restored, before, 'Dispatcher restored after teardownProxy');
  });

  // ── Proxy interception ────────────────────────────

  it('request goes through proxy CONNECT tunnel with HTTP_PROXY set', async () => {
    process.env.HTTP_PROXY = `http://localhost:${proxyPort}`;
    setupProxy();

    proxyConnectCount = 0;
    const resp = await request(`http://localhost:${targetPort}/test`, { method: 'GET' });
    const body = await resp.body.text();
    assert.equal(body, 'from-target', 'Should receive response from target via proxy');
    assert.equal(proxyConnectCount, 1, 'Proxy should have handled exactly one CONNECT request');
  });

  it('NO_PROXY bypasses proxy for matching target', async () => {
    process.env.HTTP_PROXY = `http://localhost:${proxyPort}`;
    // Match exact host:port
    process.env.NO_PROXY = `localhost:${targetPort}`;
    setupProxy();

    proxyConnectCount = 0;
    const resp = await request(`http://localhost:${targetPort}/test-noproxy`, { method: 'GET' });
    const body = await resp.body.text();
    assert.equal(body, 'from-target', 'Should receive response directly from target');
    assert.equal(proxyConnectCount, 0,
      'Proxy should NOT have intercepted the request when NO_PROXY matches');
  });

  it('NO_PROXY=* bypasses everything', async () => {
    process.env.HTTP_PROXY = `http://localhost:${proxyPort}`;
    process.env.NO_PROXY = '*';
    setupProxy();

    proxyConnectCount = 0;
    const resp = await request(`http://localhost:${targetPort}/test-noproxy-all`, { method: 'GET' });
    const body = await resp.body.text();
    assert.equal(body, 'from-target', 'Should receive response directly from target');
    assert.equal(proxyConnectCount, 0, 'Proxy should not intercept when NO_PROXY=*');
  });
});
