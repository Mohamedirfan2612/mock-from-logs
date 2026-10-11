const TEXTUAL_MIME_PATTERNS = [
  /^text\//i,
  /^application\/json/i,
  /^application\/.*\+json/i,
  /^application\/xml/i,
  /^application\/.*\+xml/i,
  /^application\/javascript/i,
  /^application\/x-javascript/i,
  /^application\/x-www-form-urlencoded/i,
  /^application\/graphql/i,
];

export function isTextualContentType(contentType?: string): boolean {
  if (!contentType) return false;
  const mime = contentType.split(';')[0]?.trim() ?? '';
  return TEXTUAL_MIME_PATTERNS.some((pattern) => pattern.test(mime));
}

export function cleanUrl(url: string): string {
  if (!url) return '';
  // Strip query string and fragment/hash
  const queryIndex = url.indexOf('?');
  const hashIndex = url.indexOf('#');
  let cutIndex = -1;
  if (queryIndex !== -1 && hashIndex !== -1) {
    cutIndex = Math.min(queryIndex, hashIndex);
  } else if (queryIndex !== -1) {
    cutIndex = queryIndex;
  } else if (hashIndex !== -1) {
    cutIndex = hashIndex;
  }

  return cutIndex !== -1 ? url.substring(0, cutIndex) : url;
}

export function parseAndDecodeBody(
  rawBody: unknown,
  contentType?: string,
  encoding?: string,
): unknown {
  if (rawBody === undefined || rawBody === null) {
    return undefined;
  }

  let text: string | unknown = rawBody;

  if (typeof rawBody === 'string') {
    if (encoding === 'base64') {
      if (!isTextualContentType(contentType)) {
        // Drop binary bodies
        return undefined;
      }
      try {
        text = Buffer.from(rawBody, 'base64').toString('utf-8');
      } catch {
        return undefined;
      }
    }

    if (typeof text === 'string') {
      const trimmed = text.trim();
      const isJsonCandidate =
        (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
        (contentType && /json/i.test(contentType));

      if (isJsonCandidate) {
        try {
          return JSON.parse(trimmed);
        } catch {
          // If JSON parsing fails, fall back to string text
          return text;
        }
      }
      return text;
    }
  }

  return text;
}
