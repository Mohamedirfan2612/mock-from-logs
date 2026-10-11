import { describe, it, expect, afterEach } from 'vitest';
import { startMockServer, createMockServer } from '../src/server.js';
import type { MockSpec, ServerInstance } from '../src/types.js';

describe('Mock server (node:http)', () => {
  let serverInstance: ServerInstance | undefined;

  afterEach(async () => {
    if (serverInstance) {
      await serverInstance.close();
      serverInstance = undefined;
    }
  });

  const testSpec: MockSpec = {
    version: 1,
    routes: [
      {
        method: 'GET',
        path: '/users/me',
        samples: [{ status: 200, contentType: 'application/json', body: { user: 'me' } }],
      },
      {
        method: 'GET',
        path: '/users/:id',
        samples: [
          { status: 200, contentType: 'application/json', body: { id: 1, name: 'Sample 1' } },
          { status: 200, contentType: 'application/json', body: { id: 2, name: 'Sample 2' } },
          { status: 404, contentType: 'application/json', body: { error: 'User Not Found' } },
        ],
      },
      {
        method: 'POST',
        path: '/users',
        samples: [{ status: 201, contentType: 'application/json', body: { created: true } }],
      },
      {
        method: 'DELETE',
        path: '/users/:id',
        samples: [{ status: 204 }],
      },
    ],
  };

  it('serves routes with specificity, favoring fixed routes over parameterized routes', async () => {
    serverInstance = await startMockServer(testSpec, { port: 0 });

    const meRes = await fetch(`${serverInstance.url}/users/me`);
    expect(meRes.status).toBe(200);
    const meData = await meRes.json();
    expect(meData).toEqual({ user: 'me' });
  });

  it('rotates through 2xx samples on subsequent requests', async () => {
    serverInstance = await startMockServer(testSpec, { port: 0 });

    const res1 = await fetch(`${serverInstance.url}/users/123`);
    const data1 = await res1.json();
    expect(data1).toEqual({ id: 1, name: 'Sample 1' });

    const res2 = await fetch(`${serverInstance.url}/users/123`);
    const data2 = await res2.json();
    expect(data2).toEqual({ id: 2, name: 'Sample 2' });

    const res3 = await fetch(`${serverInstance.url}/users/123`);
    const data3 = await res3.json();
    expect(data3).toEqual({ id: 1, name: 'Sample 1' });
  });

  it('forces recorded status via query param and header', async () => {
    serverInstance = await startMockServer(testSpec, { port: 0 });

    // via query param ?__mock_status=404
    const resQuery = await fetch(`${serverInstance.url}/users/123?__mock_status=404`);
    expect(resQuery.status).toBe(404);
    const dataQuery = await resQuery.json();
    expect(dataQuery).toEqual({ error: 'User Not Found' });

    // via header x-mock-status: 404
    const resHeader = await fetch(`${serverInstance.url}/users/123`, {
      headers: { 'x-mock-status': '404' },
    });
    expect(resHeader.status).toBe(404);
    const dataHeader = await resHeader.json();
    expect(dataHeader).toEqual({ error: 'User Not Found' });
  });

  it('answers with JSON error when forced status was not recorded', async () => {
    serverInstance = await startMockServer(testSpec, { port: 0 });

    const res = await fetch(`${serverInstance.url}/users/123?__mock_status=500`);
    expect(res.status).toBe(500);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.error).toBe('Mock status override');
    expect(data.status).toBe(500);
  });

  it('handles CORS and OPTIONS preflight by echoing requested headers', async () => {
    serverInstance = await startMockServer(testSpec, { port: 0, cors: true });

    const optionsRes = await fetch(`${serverInstance.url}/users/123`, {
      method: 'OPTIONS',
      headers: {
        'Access-Control-Request-Headers': 'X-Custom-Auth, Content-Type',
      },
    });

    expect(optionsRes.status).toBe(204);
    expect(optionsRes.headers.get('access-control-allow-origin')).toBe('*');
    expect(optionsRes.headers.get('access-control-allow-headers')).toBe(
      'X-Custom-Auth, Content-Type',
    );
  });

  it('returns 204 with no body', async () => {
    serverInstance = await startMockServer(testSpec, { port: 0 });

    const res = await fetch(`${serverInstance.url}/users/123`, { method: 'DELETE' });
    expect(res.status).toBe(204);
    const text = await res.text();
    expect(text).toBe('');
  });

  it('returns 404 JSON error for unknown route', async () => {
    serverInstance = await startMockServer(testSpec, { port: 0 });

    const res = await fetch(`${serverInstance.url}/nonexistent`);
    expect(res.status).toBe(404);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.error).toBe('Not Found');
  });

  it('supports latency delay option', async () => {
    serverInstance = await startMockServer(testSpec, { port: 0, delayMs: 100 });

    const start = Date.now();
    await fetch(`${serverInstance.url}/users/me`);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(80);
  });

  it('binds to random port when port is 0 and creates server without start', () => {
    const { server } = createMockServer(testSpec);
    expect(server).toBeDefined();
  });
});
