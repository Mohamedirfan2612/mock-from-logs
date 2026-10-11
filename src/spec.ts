import type {
  MockRoute,
  MockSample,
  MockSpec,
  RawTrafficEntry,
  SpecBuilderOptions,
} from './types.js';
import { extractHost, inferRoute, normalizePath } from './routes.js';
import { maskTrafficEntry } from './mask.js';

const STATIC_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.css',
  '.map',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.ico',
  '.webp',
  '.avif',
  '.bmp',
  '.tiff',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.otf',
  '.mp4',
  '.webm',
  '.ogv',
  '.mp3',
  '.wav',
  '.ogg',
  '.flac',
  '.aac',
]);

const STATIC_MIME_PATTERNS = [
  /^text\/javascript/i,
  /^application\/javascript/i,
  /^application\/x-javascript/i,
  /^text\/css/i,
  /^image\//i,
  /^font\//i,
  /^application\/font-woff/i,
  /^application\/x-font-woff/i,
  /^audio\//i,
  /^video\//i,
];

export function isStaticAsset(url: string, contentType?: string): boolean {
  const pathname = normalizePath(url).toLowerCase();
  const lastDot = pathname.lastIndexOf('.');
  if (lastDot !== -1) {
    const ext = pathname.slice(lastDot);
    if (STATIC_EXTENSIONS.has(ext)) return true;
  }

  if (contentType) {
    const mime = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
    if (STATIC_MIME_PATTERNS.some((p) => p.test(mime))) {
      return true;
    }
  }

  return false;
}

export function canonicalStringify(val: unknown): string {
  if (val === undefined) return '__undefined__';
  if (val === null) return 'null';
  if (typeof val !== 'object') return JSON.stringify(val);
  if (Array.isArray(val)) {
    return '[' + val.map(canonicalStringify).join(',') + ']';
  }
  const keys = Object.keys(val as Record<string, unknown>).sort();
  return (
    '{' +
    keys
      .map((k) => JSON.stringify(k) + ':' + canonicalStringify((val as Record<string, unknown>)[k]))
      .join(',') +
    '}'
  );
}

export function buildMockSpec(
  rawEntries: RawTrafficEntry[],
  options?: SpecBuilderOptions,
): MockSpec {
  const maxSamples = options?.maxSamples ?? 5;

  // Mask entries first (unless disabled)
  let warnedDisabled = false;
  const entries: RawTrafficEntry[] = [];
  for (const raw of rawEntries) {
    if (options?.mask?.unsafeDisableMasking && !warnedDisabled) {
      console.warn(
        '[mock-from-logs] WARNING: Masking is disabled via unsafeDisableMasking. Sensitive data and personal information may be exposed in the output!',
      );
      warnedDisabled = true;
    }
    entries.push(
      options?.mask?.unsafeDisableMasking ? { ...raw } : maskTrafficEntry(raw, options?.mask),
    );
  }

  // Grouping map: key = `${method} ${path}`
  const routeMap = new Map<
    string,
    {
      method: string;
      path: string;
      statusSampleMap: Map<number, { sample: MockSample; canonical: string }[]>;
    }
  >();

  for (const entry of entries) {
    // 1. Skip status 0 and 304
    if (entry.status === 0 || entry.status === 304) {
      continue;
    }

    // 2. Filter by host if specified
    if (options?.host) {
      const entryHost = extractHost(entry.url);
      if (!entryHost || entryHost !== options.host.toLowerCase()) {
        continue;
      }
    }

    const path = normalizePath(entry.url);

    // 3. Filter by include prefixes
    if (options?.include && options.include.length > 0) {
      const included = options.include.some((prefix) => path.startsWith(normalizePath(prefix)));
      if (!included) continue;
    }

    // 4. Filter by exclude prefixes
    if (options?.exclude && options.exclude.length > 0) {
      const excluded = options.exclude.some((prefix) => path.startsWith(normalizePath(prefix)));
      if (excluded) continue;
    }

    // 5. Skip static assets unless includeStatic
    if (!options?.includeStatic && isStaticAsset(entry.url, entry.contentType)) {
      continue;
    }

    // 6. Infer route template
    const routePath = inferRoute(entry.url, { extraRegexes: options?.extraRegexes });
    const method = entry.method.toUpperCase();
    const groupKey = `${method} ${routePath}`;

    if (!routeMap.has(groupKey)) {
      routeMap.set(groupKey, {
        method,
        path: routePath,
        statusSampleMap: new Map(),
      });
    }

    const group = routeMap.get(groupKey)!;
    if (!group.statusSampleMap.has(entry.status)) {
      group.statusSampleMap.set(entry.status, []);
    }

    const statusSamples = group.statusSampleMap.get(entry.status)!;
    const sample: MockSample = {
      status: entry.status,
      contentType: entry.contentType,
      body: entry.responseBody,
    };

    const canonical = `${sample.status}:${sample.contentType ?? ''}:${canonicalStringify(sample.body)}`;

    // Deduplicate identical responses
    const isDuplicate = statusSamples.some((s) => s.canonical === canonical);
    if (!isDuplicate && statusSamples.length < maxSamples) {
      statusSamples.push({ sample, canonical });
    }
  }

  // Build sorted routes list
  const routes: MockRoute[] = [];

  for (const group of routeMap.values()) {
    const allSamples: MockSample[] = [];

    // Collect and sort samples by status ascending, then canonical body
    const sortedStatuses = Array.from(group.statusSampleMap.keys()).sort((a, b) => a - b);
    for (const st of sortedStatuses) {
      const list = group.statusSampleMap.get(st)!;
      list.sort((a, b) => a.canonical.localeCompare(b.canonical));
      for (const item of list) {
        allSamples.push(item.sample);
      }
    }

    routes.push({
      method: group.method,
      path: group.path,
      samples: allSamples,
    });
  }

  // Sort routes: path ascending, then method ascending
  routes.sort((a, b) => {
    const pathCmp = a.path.localeCompare(b.path);
    if (pathCmp !== 0) return pathCmp;
    return a.method.localeCompare(b.method);
  });

  return {
    version: 1,
    routes,
  };
}
