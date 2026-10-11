import http, { type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import type { Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import type { MockRoute, MockSample, MockSpec, ServerInstance, ServerOptions } from './types.js';
import { getRouteSpecificity, matchRoute, normalizePath } from './routes.js';

export function createMockRequestHandler(
  spec: MockSpec,
  options?: ServerOptions,
): (req: IncomingMessage, res: ServerResponse) => void {
  const corsEnabled = options?.cors ?? true;
  const delayMs = options?.delayMs ?? 0;

  // Track sample rotation index per route: key = `${method} ${path}`
  const rotationIndexMap = new Map<string, number>();

  return (req: IncomingMessage, res: ServerResponse) => {
    // 1. CORS headers
    if (corsEnabled) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS');
      const reqHeaders = req.headers['access-control-request-headers'];
      if (reqHeaders) {
        res.setHeader('Access-Control-Allow-Headers', reqHeaders);
      } else {
        res.setHeader('Access-Control-Allow-Headers', '*');
      }
      res.setHeader('Access-Control-Max-Age', '86400');

      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
      }
    }

    const rawUrl = req.url || '/';
    let pathname = '/';
    let queryParams: URLSearchParams | undefined;

    try {
      const parsed = new URL(rawUrl, 'http://127.0.0.1');
      pathname = normalizePath(parsed.pathname);
      queryParams = parsed.searchParams;
    } catch {
      pathname = normalizePath(rawUrl.split('?')[0] || '/');
    }

    const method = (req.method || 'GET').toUpperCase();

    // 2. Find matching routes
    const matchedRoutes: { route: MockRoute; specificity: number }[] = [];
    for (const r of spec.routes) {
      if (r.method.toUpperCase() === method) {
        const match = matchRoute(pathname, r.path);
        if (match.matched) {
          const { specificityScore } = getRouteSpecificity(r.path);
          matchedRoutes.push({ route: r, specificity: specificityScore });
        }
      }
    }

    // 3. Unknown route -> 404 JSON error
    if (matchedRoutes.length === 0) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          error: 'Not Found',
          message: `No mock route matching ${method} ${pathname}`,
        }),
      );
      return;
    }

    // Sort by specificity descending (more specific route wins)
    matchedRoutes.sort((a, b) => b.specificity - a.specificity);
    const chosenRoute = matchedRoutes[0]!.route;
    const routeKey = `${chosenRoute.method} ${chosenRoute.path}`;

    // 4. Check for status override: ?__mock_status=... or x-mock-status header
    const statusOverrideRaw =
      queryParams?.get('__mock_status') || (req.headers['x-mock-status'] as string | undefined);

    let chosenSample: MockSample | undefined;

    if (statusOverrideRaw) {
      const forcedStatus = Number(statusOverrideRaw);
      if (!Number.isNaN(forcedStatus)) {
        chosenSample = chosenRoute.samples.find((s) => s.status === forcedStatus);
        if (!chosenSample) {
          // If no sample recorded for that status, answer with that status and a JSON error
          res.statusCode = forcedStatus;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              error: 'Mock status override',
              status: forcedStatus,
              message: `No sample recorded for status ${forcedStatus} on route ${chosenRoute.path}`,
            }),
          );
          return;
        }
      }
    }

    // 5. If no status override, rotate through 2xx samples (or all samples if no 2xx exist)
    if (!chosenSample) {
      const twoHundredSamples = chosenRoute.samples.filter(
        (s) => s.status >= 200 && s.status < 300,
      );
      const pool = twoHundredSamples.length > 0 ? twoHundredSamples : chosenRoute.samples;

      if (pool.length === 0) {
        res.statusCode = 200;
        res.end();
        return;
      }

      const currentIndex = rotationIndexMap.get(routeKey) ?? 0;
      chosenSample = pool[currentIndex % pool.length];
      rotationIndexMap.set(routeKey, currentIndex + 1);
    }

    // 6. Respond with delay (if any)
    const sendResponse = () => {
      res.statusCode = chosenSample!.status;

      // 204 No Content and 304 Not Modified must NOT have a body
      if (chosenSample!.status === 204 || chosenSample!.status === 304) {
        res.end();
        return;
      }

      if (chosenSample!.contentType) {
        res.setHeader('Content-Type', chosenSample!.contentType);
      }

      if (chosenSample!.body === undefined || chosenSample!.body === null) {
        res.end();
        return;
      }

      if (typeof chosenSample!.body === 'object') {
        if (!chosenSample!.contentType) {
          res.setHeader('Content-Type', 'application/json');
        }
        res.end(JSON.stringify(chosenSample!.body));
      } else {
        if (!chosenSample!.contentType) {
          res.setHeader('Content-Type', 'text/plain');
        }
        res.end(String(chosenSample!.body));
      }
    };

    if (delayMs > 0) {
      setTimeout(sendResponse, delayMs);
    } else {
      sendResponse();
    }
  };
}

export function createMockServer(spec: MockSpec, options?: ServerOptions): { server: Server } {
  const handler = createMockRequestHandler(spec, options);
  const server = http.createServer(handler);
  return { server };
}

export async function startMockServer(
  spec: MockSpec,
  options?: ServerOptions,
): Promise<ServerInstance> {
  const { server } = createMockServer(spec, options);
  const host = options?.host ?? '127.0.0.1';
  const requestedPort = options?.port ?? 4000;

  // Track sockets for immediate clean shutdown
  const sockets = new Set<Socket>();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => {
      sockets.delete(socket);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.on('error', reject);
    server.listen(requestedPort, host, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  const actualPort = address.port;
  const url = `http://${host}:${actualPort}`;

  const close = async (): Promise<void> => {
    return new Promise<void>((resolve, reject) => {
      // Close all sockets
      if (typeof server.closeAllConnections === 'function') {
        server.closeAllConnections();
      }
      for (const socket of sockets) {
        socket.destroy();
      }
      sockets.clear();

      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  };

  return {
    server,
    url,
    port: actualPort,
    host,
    close,
  };
}
