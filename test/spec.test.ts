import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { loadHar } from '../src/har.js';
import { buildMockSpec, canonicalStringify, isStaticAsset } from '../src/spec.js';
import type { RawTrafficEntry } from '../src/types.js';

describe('Spec builder (buildMockSpec)', () => {
  const harPath = resolve(__dirname, 'fixtures/sample.har');
  const { entries: sampleEntries } = loadHar(harPath);

  it('filters out status 0, 304, and static assets by default', () => {
    const spec = buildMockSpec(sampleEntries);

    // Should not contain .js or .png
    const paths = spec.routes.map((r) => r.path);
    expect(paths.some((p) => p.endsWith('.js') || p.endsWith('.png'))).toBe(false);

    // Should not contain 304 sample
    for (const route of spec.routes) {
      for (const sample of route.samples) {
        expect(sample.status).not.toBe(304);
        expect(sample.status).not.toBe(0);
      }
    }
  });

  it('includes static assets when includeStatic is true', () => {
    const spec = buildMockSpec(sampleEntries, { includeStatic: true });
    const paths = spec.routes.map((r) => r.path);
    expect(paths.some((p) => p.includes('/assets/app.js'))).toBe(true);
  });

  it('filters by host', () => {
    const spec = buildMockSpec(sampleEntries, { host: 'other.service.com' });
    expect(spec.routes.length).toBe(1);
    expect(spec.routes[0]!.path).toBe('/health');
  });

  it('filters by include and exclude prefixes', () => {
    const specInc = buildMockSpec(sampleEntries, { include: ['/users'] });
    for (const r of specInc.routes) {
      expect(r.path.startsWith('/users')).toBe(true);
    }

    const specExc = buildMockSpec(sampleEntries, { exclude: ['/users'] });
    for (const r of specExc.routes) {
      expect(r.path.startsWith('/users')).toBe(false);
    }
  });

  it('groups samples by method + route, respects maxSamples, and deduplicates identical responses', () => {
    const duplicateEntries: RawTrafficEntry[] = [
      {
        method: 'GET',
        url: '/items/1',
        status: 200,
        contentType: 'application/json',
        responseBody: { name: 'Item', count: 10 },
      },
      // Exact duplicate with different key order in JSON
      {
        method: 'GET',
        url: '/items/2',
        status: 200,
        contentType: 'application/json',
        responseBody: { count: 10, name: 'Item' },
      },
      // Different response
      {
        method: 'GET',
        url: '/items/3',
        status: 200,
        contentType: 'application/json',
        responseBody: { name: 'Different' },
      },
      // Same route, different status
      {
        method: 'GET',
        url: '/items/4',
        status: 404,
        contentType: 'application/json',
        responseBody: { error: 'Not found' },
      },
    ];

    const spec = buildMockSpec(duplicateEntries, { maxSamples: 5 });
    expect(spec.routes.length).toBe(1);
    const route = spec.routes[0]!;
    expect(route.path).toBe('/items/:id');
    // Duplicated item response deduplicated into 1 sample + 1 different 200 sample + 1 404 sample = 3 samples
    expect(route.samples.length).toBe(3);
  });

  it('caps samples per status to maxSamples', () => {
    const manyEntries: RawTrafficEntry[] = [];
    for (let i = 0; i < 10; i++) {
      manyEntries.push({
        method: 'GET',
        url: `/users/${i}`,
        status: 200,
        contentType: 'application/json',
        responseBody: { id: i },
      });
    }

    const spec = buildMockSpec(manyEntries, { maxSamples: 3 });
    expect(spec.routes[0]!.samples.length).toBe(3);
  });

  it('sorts routes and samples deterministically', () => {
    const spec = buildMockSpec(sampleEntries);
    expect(spec.version).toBe(1);

    // Routes must be sorted alphabetically by path, then method
    for (let i = 1; i < spec.routes.length; i++) {
      const prev = spec.routes[i - 1]!;
      const curr = spec.routes[i]!;
      const pathCmp = prev.path.localeCompare(curr.path);
      if (pathCmp === 0) {
        expect(prev.method.localeCompare(curr.method)).toBeLessThanOrEqual(0);
      } else {
        expect(pathCmp).toBeLessThan(0);
      }
    }

    // Samples within a route must be sorted by status ascending
    for (const route of spec.routes) {
      for (let i = 1; i < route.samples.length; i++) {
        expect(route.samples[i]!.status).toBeGreaterThanOrEqual(route.samples[i - 1]!.status);
      }
    }
  });

  it('helper canonicalStringify and isStaticAsset works accurately', () => {
    expect(canonicalStringify(undefined)).toBe('__undefined__');
    expect(canonicalStringify(null)).toBe('null');
    expect(canonicalStringify({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(isStaticAsset('/test.css')).toBe(true);
    expect(isStaticAsset('/test.jpg')).toBe(true);
    expect(isStaticAsset('/api/users', 'text/css')).toBe(true);
    expect(isStaticAsset('/api/users', 'application/json')).toBe(false);
  });
});
