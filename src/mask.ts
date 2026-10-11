import { createHash } from 'node:crypto';
import type { MaskOptions, RawTrafficEntry } from './types.js';

const SENSITIVE_KEY_PATTERNS = [
  'password',
  'passwd',
  'secret',
  'token',
  'apikey',
  'authorization',
  'privatekey',
  'ssn',
  'creditcard',
  'cardnumber',
  'cvv',
  'cvc',
];

const MAX_DEPTH = 50;

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function isSensitiveKey(key: string, options?: MaskOptions): boolean {
  const normKey = normalizeKey(key);
  const lowerKey = key.toLowerCase();

  // Allow list takes precedence
  if (options?.allowKeys && options.allowKeys.length > 0) {
    const isAllowed = options.allowKeys.some((ak) => {
      return ak.toLowerCase() === lowerKey || normalizeKey(ak) === normKey;
    });
    if (isAllowed) return false;
  }

  // Deny list forces redaction
  if (options?.denyKeys && options.denyKeys.length > 0) {
    const isDenied = options.denyKeys.some((dk) => {
      const normDk = normalizeKey(dk);
      return dk.toLowerCase() === lowerKey || (normDk.length > 0 && normKey.includes(normDk));
    });
    if (isDenied) return true;
  }

  return SENSITIVE_KEY_PATTERNS.some((pattern) => normKey.includes(pattern));
}

export function deterministicEmail(email: string): string {
  const hash8 = createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 8);
  return `user_${hash8}@example.com`;
}

export function deterministicPhone(phoneStr: string): string {
  const digits = phoneStr.replace(/\D/g, '');
  const hash = createHash('sha256').update(digits).digest('hex');
  const num = parseInt(hash.slice(0, 8), 16) % 10000000;
  const padded = String(num).padStart(7, '0');
  return `+1555${padded}`;
}

export function maskString(text: string): string {
  if (!text) return text;

  // 1. Mask Bearer tokens: "Bearer <token>" -> "Bearer [REDACTED]"
  let result = text.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]');

  // 2. Mask JWTs: ey... . ey... . ...
  result = result.replace(
    /\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\b/g,
    '[REDACTED_JWT]',
  );

  // 3. Mask Emails: standard and percent-encoded
  result = result.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, (match) =>
    deterministicEmail(match),
  );
  result = result.replace(/[a-zA-Z0-9._%+-]+%40[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi, (match) => {
    const decoded = match.replace(/%40/i, '@');
    return deterministicEmail(decoded);
  });

  // 4. Mask Phone numbers (international, (xxx) xxx-xxxx, xxx-xxx-xxxx)
  // Guard against ISO dates / timestamps
  const trimmed = result.trim();
  const isIsoDate = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/i.test(
    trimmed,
  );

  if (!isIsoDate) {
    // International phone with +
    result = result.replace(
      /\+\d{1,3}[-.\s]?\(?\d{1,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}\b/g,
      (match) => deterministicPhone(match),
    );

    // US format (xxx) xxx-xxxx
    result = result.replace(/\(\d{3}\)[-.\s]?\d{3}[-.\s]?\d{4}\b/g, (match) =>
      deterministicPhone(match),
    );

    // US format xxx-xxx-xxxx or xxx.xxx.xxxx
    result = result.replace(/\b\d{3}[-.]\d{3}[-.]\d{4}\b/g, (match) => deterministicPhone(match));
  }

  return result;
}

export function maskValue(
  val: unknown,
  options?: MaskOptions,
  depth = 0,
  seen = new WeakSet<object>(),
): unknown {
  if (depth > MAX_DEPTH) {
    return '[MAX_DEPTH_EXCEEDED]';
  }

  if (val === null || val === undefined) {
    return val;
  }

  if (typeof val === 'string') {
    return maskString(val);
  }

  if (typeof val === 'number' || typeof val === 'boolean' || typeof val === 'bigint') {
    return val;
  }

  if (typeof val === 'object') {
    if (seen.has(val)) {
      return '[CIRCULAR]';
    }
    seen.add(val);

    if (Array.isArray(val)) {
      return val.map((item) => maskValue(item, options, depth + 1, seen));
    }

    const res: Record<string, unknown> = {};
    for (const [key, itemVal] of Object.entries(val)) {
      const maskedKey = maskString(key);
      if (isSensitiveKey(key, options)) {
        res[maskedKey] = '[REDACTED]';
      } else {
        res[maskedKey] = maskValue(itemVal, options, depth + 1, seen);
      }
    }
    return res;
  }

  return val;
}

export function maskData<T>(data: T, options?: MaskOptions): T {
  if (options?.unsafeDisableMasking) {
    console.warn(
      '[mock-from-logs] WARNING: Masking is disabled via unsafeDisableMasking. Sensitive data and personal information may be exposed in the output!',
    );
    return data;
  }

  return maskValue(data, options) as T;
}

export function maskTrafficEntry(entry: RawTrafficEntry, options?: MaskOptions): RawTrafficEntry {
  if (options?.unsafeDisableMasking) {
    console.warn(
      '[mock-from-logs] WARNING: Masking is disabled via unsafeDisableMasking. Sensitive data and personal information may be exposed in the output!',
    );
    return { ...entry };
  }

  return {
    method: entry.method,
    url: maskString(entry.url),
    status: entry.status,
    contentType: entry.contentType,
    responseBody: maskValue(entry.responseBody, options),
  };
}
