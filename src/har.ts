import { readFileSync, existsSync } from 'node:fs';
import type { LoaderResult, RawTrafficEntry } from './types.js';
import { cleanUrl, parseAndDecodeBody } from './body.js';

export function loadHar(input: string | object): LoaderResult {
  let data: unknown;

  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (existsSync(input)) {
      const content = readFileSync(input, 'utf-8');
      data = JSON.parse(content);
    } else if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      data = JSON.parse(trimmed);
    } else {
      throw new Error(`Invalid HAR input: file not found or not valid JSON`);
    }
  } else if (typeof input === 'object' && input !== null) {
    data = input;
  } else {
    throw new Error(`Invalid HAR input: expected file path, JSON string, or object`);
  }

  const entries: RawTrafficEntry[] = [];
  let skippedCount = 0;

  const harObj = data as { log?: { entries?: unknown[] } };
  const rawEntries = harObj?.log?.entries;
  if (!Array.isArray(rawEntries)) {
    return { entries: [], skippedCount: 0, totalCount: 0 };
  }

  for (const item of rawEntries) {
    if (!item || typeof item !== 'object') {
      skippedCount++;
      continue;
    }

    const entryObj = item as Record<string, unknown>;
    const request = entryObj.request as Record<string, unknown> | undefined;
    const response = entryObj.response as Record<string, unknown> | undefined;

    if (!request || !response) {
      skippedCount++;
      continue;
    }

    const rawMethod = request.method;
    const rawUrl = request.url;
    const rawStatus = response.status;

    if (
      typeof rawMethod !== 'string' ||
      !rawMethod.trim() ||
      typeof rawUrl !== 'string' ||
      !rawUrl.trim() ||
      typeof rawStatus !== 'number' ||
      Number.isNaN(rawStatus)
    ) {
      skippedCount++;
      continue;
    }

    const contentObj = response.content as Record<string, unknown> | undefined;
    let contentType: string | undefined =
      typeof contentObj?.mimeType === 'string' ? contentObj.mimeType : undefined;
    if (!contentType && Array.isArray(response.headers)) {
      const ctHeader = response.headers.find(
        (h) =>
          typeof h === 'object' &&
          h !== null &&
          typeof (h as { name?: unknown }).name === 'string' &&
          (h as { name: string }).name.toLowerCase() === 'content-type',
      ) as { value?: unknown } | undefined;
      if (ctHeader && typeof ctHeader.value === 'string') {
        contentType = ctHeader.value;
      }
    }

    const rawBody = contentObj?.text;
    const encoding = typeof contentObj?.encoding === 'string' ? contentObj.encoding : undefined;
    const body = parseAndDecodeBody(rawBody, contentType, encoding);

    entries.push({
      method: rawMethod.trim().toUpperCase(),
      url: cleanUrl(rawUrl.trim()),
      status: rawStatus,
      contentType: contentType || undefined,
      responseBody: body,
    });
  }

  return {
    entries,
    skippedCount,
    totalCount: entries.length + skippedCount,
  };
}
