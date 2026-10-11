import { createReadStream, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import type { JsonlLoaderOptions, LoaderResult, RawTrafficEntry } from './types.js';
import { cleanUrl, parseAndDecodeBody } from './body.js';

function getNestedValue(obj: unknown, path: string): unknown {
  if (!obj || typeof obj !== 'object') return undefined;
  if (!path) return undefined;

  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

const DEFAULT_MAPPING = {
  method: 'method',
  url: 'url',
  status: 'status',
  contentType: 'contentType',
  responseBody: 'responseBody',
};

export async function loadJsonl(
  input: string | NodeJS.ReadableStream,
  options?: JsonlLoaderOptions,
): Promise<LoaderResult> {
  const mapping = { ...DEFAULT_MAPPING, ...(options?.mapping ?? {}) };

  let stream: NodeJS.ReadableStream;

  if (typeof input === 'string') {
    if (!input.includes('\n') && existsSync(input)) {
      stream = createReadStream(input, { encoding: 'utf-8' });
    } else {
      stream = Readable.from([input]);
    }
  } else {
    stream = input;
  }

  const rl = createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  const entries: RawTrafficEntry[] = [];
  let skippedCount = 0;

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) {
      skippedCount++;
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      skippedCount++;
      continue;
    }

    if (!parsed || typeof parsed !== 'object') {
      skippedCount++;
      continue;
    }

    const rawMethod = getNestedValue(parsed, mapping.method);
    const rawUrl = getNestedValue(parsed, mapping.url);
    const rawStatus = getNestedValue(parsed, mapping.status);
    const rawContentType = getNestedValue(parsed, mapping.contentType);
    const rawResponseBody = getNestedValue(parsed, mapping.responseBody);

    const statusNum = typeof rawStatus === 'number' ? rawStatus : Number(rawStatus);

    if (
      typeof rawMethod !== 'string' ||
      !rawMethod.trim() ||
      typeof rawUrl !== 'string' ||
      !rawUrl.trim() ||
      Number.isNaN(statusNum)
    ) {
      skippedCount++;
      continue;
    }

    const contentType = rawContentType ? String(rawContentType) : undefined;
    const body = parseAndDecodeBody(rawResponseBody, contentType);

    entries.push({
      method: rawMethod.trim().toUpperCase(),
      url: cleanUrl(rawUrl.trim()),
      status: statusNum,
      contentType,
      responseBody: body,
    });
  }

  return {
    entries,
    skippedCount,
    totalCount: entries.length + skippedCount,
  };
}
