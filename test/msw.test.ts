import { describe, it, expect } from 'vitest';
import { generateMswHandlers } from '../src/msw.js';
import type { MockSpec } from '../src/types.js';

describe('MSW v2 handler generator', () => {
  const spec: MockSpec = {
    version: 1,
    routes: [
      {
        method: 'GET',
        path: '/users/:id',
        samples: [
          { status: 200, contentType: 'application/json', body: { id: 1, name: 'Alice' } },
          { status: 404, contentType: 'application/json', body: { error: 'Not found' } },
        ],
      },
      {
        method: 'POST',
        path: '/users',
        samples: [{ status: 201, contentType: 'application/json', body: { created: true } }],
      },
      {
        method: 'CUSTOM_UNSUPPORTED',
        path: '/custom',
        samples: [{ status: 200 }],
      },
    ],
  };

  it('generates MSW v2 TypeScript module matching snapshot and requirements', () => {
    const code = generateMswHandlers(spec);

    expect(code).toContain("import { http, HttpResponse } from 'msw';");
    expect(code).toContain('export const handlers = [');
    expect(code).toContain('http.get(\'*\' + "/users/:id"');
    expect(code).toContain('http.post(\'*\' + "/users"');
    // Skips unsupported methods
    expect(code).not.toContain('http.custom_unsupported');

    // Rotation and status override logic present
    expect(code).toContain('__mock_status');
    expect(code).toContain('x-mock-status');
    expect(code).toContain('resolveMockResponse');

    expect(code).toMatchSnapshot();
  });
});
