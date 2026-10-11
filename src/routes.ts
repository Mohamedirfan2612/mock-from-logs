import type { RouteInferenceOptions } from './types.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ULID_REGEX = /^[0-7][0-9a-hj-km-np-tv-z]{25}$/i;
const HEX_16_REGEX = /^[0-9a-f]{16,}$/i;
const NUMERIC_REGEX = /^\d+$/;
const EMAIL_SEGMENT_REGEX = /(@|%40)/i;

export function normalizePath(url: string): string {
  if (!url) return '/';

  let pathname: string;
  try {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      const parsed = new URL(url);
      pathname = parsed.pathname;
    } else {
      pathname = url.split(/[?#]/)[0] || '/';
    }
  } catch {
    pathname = url.split(/[?#]/)[0] || '/';
  }

  if (!pathname.startsWith('/')) {
    pathname = '/' + pathname;
  }

  // Ignore trailing slash, unless root '/'
  if (pathname.length > 1 && pathname.endsWith('/')) {
    pathname = pathname.slice(0, -1);
  }

  return pathname;
}

export function extractHost(url: string): string | undefined {
  if (!url) return undefined;
  try {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return new URL(url).host.toLowerCase();
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function isDynamicSegment(segment: string, extraRegexes?: RegExp[]): boolean {
  if (!segment) return false;

  if (NUMERIC_REGEX.test(segment)) return true;
  if (UUID_REGEX.test(segment)) return true;
  if (ULID_REGEX.test(segment)) return true;
  if (HEX_16_REGEX.test(segment)) return true;
  if (EMAIL_SEGMENT_REGEX.test(segment)) return true;

  if (extraRegexes) {
    for (const regex of extraRegexes) {
      if (regex.test(segment)) return true;
    }
  }

  return false;
}

export function inferRoute(url: string, options?: RouteInferenceOptions): string {
  const pathname = normalizePath(url);
  if (pathname === '/') return '/';

  const segments = pathname.split('/').filter(Boolean);
  let paramIndex = 1;

  const transformedSegments = segments.map((seg) => {
    if (isDynamicSegment(seg, options?.extraRegexes)) {
      const paramName = paramIndex === 1 ? ':id' : `:id${paramIndex}`;
      paramIndex++;
      return paramName;
    }
    return seg;
  });

  return '/' + transformedSegments.join('/');
}

export function getRouteSpecificity(route: string): {
  fixedCount: number;
  paramCount: number;
  specificityScore: number;
} {
  const segments = normalizePath(route).split('/').filter(Boolean);
  let fixedCount = 0;
  let paramCount = 0;
  let specificityScore = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    if (seg.startsWith(':')) {
      paramCount++;
      // Parameter segments contribute less to the score
      specificityScore += 1;
    } else {
      fixedCount++;
      // Fixed segments contribute heavily, especially earlier ones
      specificityScore += 100 * (segments.length - i);
    }
  }

  return { fixedCount, paramCount, specificityScore };
}

export function matchRoute(
  requestPath: string,
  routeTemplate: string,
): { matched: boolean; params: Record<string, string> } {
  const reqSegments = normalizePath(requestPath).split('/').filter(Boolean);
  const tplSegments = normalizePath(routeTemplate).split('/').filter(Boolean);

  if (reqSegments.length !== tplSegments.length) {
    return { matched: false, params: {} };
  }

  const params: Record<string, string> = {};

  for (let i = 0; i < reqSegments.length; i++) {
    const reqSeg = reqSegments[i]!;
    const tplSeg = tplSegments[i]!;

    if (tplSeg.startsWith(':')) {
      const paramName = tplSeg.slice(1);
      params[paramName] = reqSeg;
    } else if (reqSeg !== tplSeg) {
      return { matched: false, params: {} };
    }
  }

  return { matched: true, params };
}
