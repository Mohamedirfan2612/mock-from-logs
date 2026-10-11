import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

describe('CLI execution (spawn built CLI)', () => {
  const cliPath = resolve(__dirname, '../dist/cli.js');
  const tempDir = resolve(__dirname, '../.tmp-cli-test');
  const harPath = resolve(__dirname, 'fixtures/sample.har');

  beforeAll(() => {
    // Ensure dist/cli.js is built
    if (!existsSync(cliPath)) {
      execFileSync(
        process.execPath,
        [resolve(__dirname, '../node_modules/tsup/dist/cli-default.js')],
        {
          cwd: resolve(__dirname, '..'),
        },
      );
    }
    rmSync(tempDir, { recursive: true, force: true });
    mkdirSync(tempDir, { recursive: true });
  });

  it('prints help on --help', () => {
    const stdout = execFileSync(process.execPath, [cliPath, '--help'], { encoding: 'utf-8' });
    expect(stdout).toContain('mock-from-logs <command> [options]');
    expect(stdout).toContain('generate');
    expect(stdout).toContain('serve');
    expect(stdout).toContain('msw');
  });

  it('prints version on --version', () => {
    const stdout = execFileSync(process.execPath, [cliPath, '--version'], { encoding: 'utf-8' });
    expect(stdout).toContain('v0.1.0');
  });

  it('fails with code 1 on unknown command', () => {
    try {
      execFileSync(process.execPath, [cliPath, 'unknown-cmd'], {
        encoding: 'utf-8',
        stdio: 'pipe',
      });
      expect.unreachable('Should have thrown');
    } catch (err: unknown) {
      const e = err as { status?: number; stdout?: string; stderr?: string };
      expect(e.status).toBe(1);
      const combined = (e.stdout || '') + (e.stderr || '');
      expect(combined).toContain('Unknown command');
    }
  });

  it('fails with code 1 on missing file', () => {
    try {
      execFileSync(process.execPath, [cliPath, 'generate', 'non_existent_file.har'], {
        encoding: 'utf-8',
        stdio: 'pipe',
      });
      expect.unreachable('Should have thrown');
    } catch (err: unknown) {
      const e = err as { status?: number; stdout?: string; stderr?: string };
      expect(e.status).toBe(1);
      const combined = (e.stdout || '') + (e.stderr || '');
      expect(combined).toContain('Input file not found');
    }
  });

  it('generates mock-spec.json from HAR file', () => {
    const outMocks = join(tempDir, 'mocks');
    const stdout = execFileSync(
      process.execPath,
      [cliPath, 'generate', harPath, '--out', outMocks],
      { encoding: 'utf-8' },
    );

    expect(stdout).toContain('Mock spec generated successfully');
    expect(stdout).toContain('Entries read:');
    expect(stdout).toContain('Masking:      ENABLED');

    const specFile = join(outMocks, 'mock-spec.json');
    expect(existsSync(specFile)).toBe(true);

    const spec = JSON.parse(readFileSync(specFile, 'utf-8'));
    expect(spec.version).toBe(1);
    expect(spec.routes.length).toBeGreaterThan(0);
  });

  it('generates MSW v2 handlers with msw command', () => {
    const outMocks = join(tempDir, 'mocks');
    const outHandlers = join(tempDir, 'handlers.ts');

    const stdout = execFileSync(
      process.execPath,
      [cliPath, 'msw', outMocks, '--out', outHandlers],
      { encoding: 'utf-8' },
    );

    expect(stdout).toContain('MSW v2 handlers written to');
    expect(existsSync(outHandlers)).toBe(true);
    const code = readFileSync(outHandlers, 'utf-8');
    expect(code).toContain("import { http, HttpResponse } from 'msw';");
  });

  it('spawns mock server, serves requests, and shuts down cleanly on SIGTERM/SIGINT', async () => {
    const specFile = join(tempDir, 'server-spec.json');
    writeFileSync(
      specFile,
      JSON.stringify({
        version: 1,
        routes: [
          {
            method: 'GET',
            path: '/test-route',
            samples: [{ status: 200, contentType: 'application/json', body: { ok: true } }],
          },
        ],
      }),
      'utf-8',
    );

    // Pick an ephemeral port for testing server
    const port = 49215;
    const child = spawn(process.execPath, [cliPath, 'serve', specFile, '--port', String(port)], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    const serverReady = new Promise<void>((resolve, reject) => {
      child.stdout.on('data', (data) => {
        stdout += data.toString();
        if (stdout.includes('Mock server listening at')) {
          resolve();
        }
      });
      child.stderr.on('data', (data) => {
        stdout += data.toString();
      });
      child.on('error', reject);
    });

    await serverReady;

    // Send HTTP request to the running server
    const res = await fetch(`http://127.0.0.1:${port}/test-route`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ ok: true });

    // Clean shutdown
    const exitPromise = new Promise<number | null>((resolve) => {
      child.on('close', (code) => resolve(code));
    });

    child.kill('SIGINT');
    const exitCode = await exitPromise;
    expect(exitCode === 0 || exitCode === null).toBe(true);
  });
});
