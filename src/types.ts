import type { Server } from 'node:http';

export interface RawTrafficEntry {
  method: string;
  url: string;
  status: number;
  contentType?: string;
  responseBody?: unknown;
}

export interface MockSample {
  status: number;
  contentType?: string;
  body?: unknown;
}

export interface MockRoute {
  method: string;
  path: string;
  samples: MockSample[];
}

export interface MockSpec {
  version: 1;
  routes: MockRoute[];
}

export interface MaskOptions {
  unsafeDisableMasking?: boolean;
  allowKeys?: string[];
  denyKeys?: string[];
}

export interface RouteInferenceOptions {
  extraRegexes?: RegExp[];
}

export interface SpecBuilderOptions {
  host?: string;
  include?: string[];
  exclude?: string[];
  maxSamples?: number;
  includeStatic?: boolean;
  mask?: MaskOptions;
  extraRegexes?: RegExp[];
}

export interface ServerOptions {
  port?: number;
  host?: string;
  delayMs?: number;
  cors?: boolean;
}

export interface ServerInstance {
  server: Server;
  url: string;
  port: number;
  host: string;
  close: () => Promise<void>;
}

export interface LoaderResult {
  entries: RawTrafficEntry[];
  skippedCount: number;
  totalCount: number;
}

export interface JsonlLoaderOptions {
  mapping?: Record<string, string>;
}
