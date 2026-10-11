import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { loadHar } from '../src/har.js';

describe('HAR loader', () => {
  it('parses HAR file and extracts valid entries while skipping malformed ones', () => {
    const harPath = resolve(__dirname, 'fixtures/sample.har');
    const result = loadHar(harPath);

    expect(result.totalCount).toBe(13);
    expect(result.skippedCount).toBe(1); // 1 malformed entry
    expect(result.entries.length).toBe(12);

    // Assert query string is stripped from URL
    const profileEntry = result.entries.find((e) => e.url.includes('/users/profile'));
    expect(profileEntry).toBeDefined();
    expect(profileEntry!.url).toBe('https://api.example.com/users/profile');
    expect(profileEntry!.url).not.toContain('query-secret-token');

    // Assert request headers, post data, cookies are NOT present on entry
    for (const entry of result.entries) {
      const rec = entry as unknown as Record<string, unknown>;
      expect(rec.headers).toBeUndefined();
      expect(rec.requestHeaders).toBeUndefined();
      expect(rec.postData).toBeUndefined();
      expect(rec.cookies).toBeUndefined();
      expect(rec.queryString).toBeUndefined();
    }
  });

  it('decodes base64 textual body and drops binary body', () => {
    const harPath = resolve(__dirname, 'fixtures/sample.har');
    const result = loadHar(harPath);

    // Base64 textual JSON response (/auth/status)
    const authEntry = result.entries.find((e) => e.url.includes('/auth/status'));
    expect(authEntry).toBeDefined();
    expect(authEntry!.responseBody).toBeDefined();
    expect((authEntry!.responseBody as Record<string, unknown>).authenticated).toBe(true);

    // Binary body (image/png) -> dropped
    const logoEntry = result.entries.find((e) => e.url.includes('/assets/logo.png'));
    expect(logoEntry).toBeDefined();
    expect(logoEntry!.responseBody).toBeUndefined();
  });

  it('handles HAR JSON string directly and extracts Content-Type from headers when mimeType is absent', () => {
    const jsonString = JSON.stringify({
      log: {
        version: '1.2',
        entries: [
          null,
          {
            request: { method: 'GET', url: 'https://example.com/items' },
            response: {
              status: 200,
              headers: [{ name: 'Content-Type', value: 'application/json' }],
              content: { text: '{"ok":true}' },
            },
          },
          {
            request: { method: '', url: '' },
            response: { status: 200 },
          },
        ],
      },
    });

    const result = loadHar(jsonString);
    expect(result.entries.length).toBe(1);
    expect(result.skippedCount).toBe(2);
    expect(result.entries[0]!.contentType).toBe('application/json');
  });

  it('handles HAR object directly and handles missing log.entries', () => {
    const result = loadHar({ log: { version: '1.2', entries: [] } });
    expect(result.entries).toEqual([]);
    expect(result.skippedCount).toBe(0);

    const emptyResult = loadHar({});
    expect(emptyResult.entries).toEqual([]);
  });

  it('throws on invalid HAR input', () => {
    expect(() => loadHar('non_existent_file.har')).toThrow('Invalid HAR input');
    expect(() => loadHar(123 as unknown as string)).toThrow('Invalid HAR input');
  });
});
