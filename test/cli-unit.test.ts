import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolve, join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { getPackageVersion, runCli } from '../src/cli.js';

describe('CLI in-process execution unit tests', () => {
  const tempDir = resolve(__dirname, '../.tmp-cli-unit');
  const harPath = resolve(__dirname, 'fixtures/sample.har');
  const jsonlPath = resolve(__dirname, 'fixtures/sample.jsonl');

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('retrieves package version', () => {
    const version = getPackageVersion();
    expect(version).toBe('0.1.0');
  });

  it('prints help and version without throwing', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runCli(['--help']);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('mock-from-logs <command>'));

    await runCli(['-v']);
    expect(logSpy).toHaveBeenCalledWith('v0.1.0');

    logSpy.mockRestore();
  });

  it('executes generate command with options', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const outDir = join(tempDir, 'gen-out');

    await runCli([
      'generate',
      harPath,
      '--out',
      outDir,
      '--max-samples',
      '2',
      '--allow-key',
      'apiKey',
    ]);

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Mock spec generated successfully'),
    );

    // Test with jsonl and --unsafe-no-mask
    const outJsonlDir = join(tempDir, 'gen-jsonl-out');
    await runCli([
      'generate',
      jsonlPath,
      '--out',
      outJsonlDir,
      '--format',
      'jsonl',
      '--map',
      'responseBody=responseBody',
      '--unsafe-no-mask',
    ]);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Masking:      DISABLED'));

    logSpy.mockRestore();
  });

  it('executes msw command from directory spec', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const outDir = join(tempDir, 'msw-spec');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      join(outDir, 'mock-spec.json'),
      JSON.stringify({
        version: 1,
        routes: [{ method: 'GET', path: '/api/v1/ping', samples: [{ status: 200 }] }],
      }),
    );

    const mswOut = join(tempDir, 'msw-handlers.ts');
    await runCli(['msw', outDir, '--out', mswOut]);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('MSW v2 handlers written to'));

    logSpy.mockRestore();
  });

  it('throws on missing input or unknown command', async () => {
    await expect(runCli(['generate'])).rejects.toThrow(
      'Missing required input file for generate command',
    );
    await expect(runCli(['generate', 'missing.har'])).rejects.toThrow('Input file not found');
    await expect(runCli(['invalid-cmd'])).rejects.toThrow('Unknown command');
    await expect(runCli(['msw', 'non_existent_folder'])).rejects.toThrow(
      'Spec file or directory not found',
    );
  });
});
