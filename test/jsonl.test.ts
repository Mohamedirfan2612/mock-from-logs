import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { loadJsonl } from '../src/jsonl.js';

describe('JSONL loader', () => {
  it('parses JSONL file, decodes JSON values and JSON-encoded strings, skips bad lines', async () => {
    const jsonlPath = resolve(__dirname, 'fixtures/sample.jsonl');
    const result = await loadJsonl(jsonlPath);

    expect(result.totalCount).toBe(5);
    // Line 3 is invalid JSON, Line 4 is missing required fields (url, status)
    expect(result.skippedCount).toBe(2);
    expect(result.entries.length).toBe(3);

    // Line 1: native JSON object
    expect(result.entries[0]!.responseBody).toEqual({ id: 1, name: 'Item One' });
    // Line 2: stringified JSON decoded
    expect(result.entries[1]!.responseBody).toEqual({ id: 2, name: 'Item Two' });
    // Line 5: 404 response
    expect(result.entries[2]!.status).toBe(404);
  });

  it('supports custom field mapping with dotted paths', async () => {
    const customPath = resolve(__dirname, 'fixtures/custom-map.jsonl');
    const result = await loadJsonl(customPath, {
      mapping: {
        method: 'req.verb',
        url: 'req.uri',
        status: 'res.code',
        contentType: 'res.type',
        responseBody: 'res.data',
      },
    });

    expect(result.entries.length).toBe(2);
    expect(result.skippedCount).toBe(0);

    expect(result.entries[0]!.method).toBe('GET');
    expect(result.entries[0]!.url).toBe('/api/v2/orders/501');
    expect(result.entries[0]!.status).toBe(200);
    expect(result.entries[0]!.responseBody).toEqual({ orderId: 501, total: 99.95 });

    expect(result.entries[1]!.method).toBe('POST');
    expect(result.entries[1]!.url).toBe('/api/v2/orders');
    expect(result.entries[1]!.status).toBe(201);
  });

  it('handles in-memory string input', async () => {
    const content = '{"method":"DELETE","url":"/items/5","status":204}\n\n{"bad json';
    const result = await loadJsonl(content);
    expect(result.entries.length).toBe(1);
    expect(result.skippedCount).toBe(2); // empty line and bad json
  });
});
