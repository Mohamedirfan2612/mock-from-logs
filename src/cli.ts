import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { MockSpec } from './types.js';
import { loadHar } from './har.js';
import { loadJsonl } from './jsonl.js';
import { buildMockSpec } from './spec.js';
import { startMockServer } from './server.js';
import { generateMswHandlers } from './msw.js';

export function getPackageVersion(): string {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const candidatePaths = [
      join(__dirname, 'package.json'),
      join(__dirname, '..', 'package.json'),
      join(process.cwd(), 'package.json'),
    ];
    for (const p of candidatePaths) {
      if (existsSync(p)) {
        const pkg = JSON.parse(readFileSync(p, 'utf-8'));
        if (pkg.name === 'mock-from-logs' && pkg.version) {
          return pkg.version;
        }
      }
    }
  } catch {
    // fallback
  }
  return '0.1.0';
}

function printHelp(): void {
  console.log(`
mock-from-logs - Turn recorded API traffic into runnable mock APIs

USAGE:
  mock-from-logs <command> [options]

COMMANDS:
  generate <input>      Generate mock spec from HAR or JSONL traffic
  serve <spec>          Start a mock HTTP server from a mock spec
  msw <spec>            Generate MSW v2 handlers from a mock spec

OPTIONS:
  -h, --help            Show help
  -v, --version         Show version

GENERATE OPTIONS:
  --out <dir>           Output directory (default: ./mocks)
  --format <format>     Input format: har | jsonl (auto-detected if omitted)
  --host <host>         Filter traffic to a specific host
  --include <prefix>    Include route prefix (can be specified multiple times)
  --exclude <prefix>    Exclude route prefix (can be specified multiple times)
  --max-samples <num>   Max samples per route & status (default: 5)
  --include-static      Include static assets (.js, .css, images, etc.)
  --allow-key <key>     Allow sensitive key from redaction (multiple)
  --deny-key <key>      Force sensitive key redaction (multiple)
  --map <mapping>       Map JSONL field: target=path (e.g. responseBody=res.body)
  --unsafe-no-mask      Disable PII and secret masking (prints warning)

SERVE OPTIONS:
  --port <port>         Server port (default: 4000)
  --host <host>         Server host (default: 127.0.0.1)
  --delay <ms>          Artificial delay in ms (default: 0)

MSW OPTIONS:
  --out <file>          Output TypeScript file path (default: ./handlers.ts)

EXAMPLES:
  mock-from-logs generate traffic.har --out ./mocks
  mock-from-logs generate logs.jsonl --map responseBody=res.body
  mock-from-logs serve ./mocks/mock-spec.json --port 4000
  mock-from-logs msw ./mocks/mock-spec.json --out ./src/mocks/handlers.ts
`);
}

function resolveSpecPath(inputPath?: string): string {
  const candidate = inputPath || './mocks';
  const resolved = resolve(process.cwd(), candidate);

  if (existsSync(resolved)) {
    const stat = statSync(resolved);
    if (stat.isDirectory()) {
      const specInDir = join(resolved, 'mock-spec.json');
      if (existsSync(specInDir)) {
        return specInDir;
      }
      throw new Error(`Directory "${candidate}" does not contain mock-spec.json`);
    }
    return resolved;
  }

  // Also check if candidate.json exists
  if (existsSync(resolved + '.json')) {
    return resolved + '.json';
  }

  throw new Error(`Spec file or directory not found: "${candidate}"`);
}

export async function runCli(argv = process.argv.slice(2)): Promise<void> {
  // Global options check: --help, --version
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    return;
  }

  if (argv.includes('--version') || argv.includes('-v')) {
    console.log(`v${getPackageVersion()}`);
    return;
  }

  const command = argv[0];
  const commandArgs = argv.slice(1);

  if (command === 'generate') {
    const { values, positionals } = parseArgs({
      args: commandArgs,
      options: {
        out: { type: 'string', default: './mocks' },
        format: { type: 'string' },
        host: { type: 'string' },
        include: { type: 'string', multiple: true },
        exclude: { type: 'string', multiple: true },
        'max-samples': { type: 'string', default: '5' },
        'include-static': { type: 'boolean', default: false },
        'allow-key': { type: 'string', multiple: true },
        'deny-key': { type: 'string', multiple: true },
        map: { type: 'string', multiple: true },
        'unsafe-no-mask': { type: 'boolean', default: false },
      },
      allowPositionals: true,
    });

    const inputFile = positionals[0];
    if (!inputFile) {
      throw new Error('Missing required input file for generate command');
    }

    const resolvedInput = resolve(process.cwd(), inputFile);
    if (!existsSync(resolvedInput)) {
      throw new Error(`Input file not found: "${inputFile}"`);
    }

    let format = values.format?.toLowerCase();
    if (!format) {
      if (inputFile.endsWith('.har')) {
        format = 'har';
      } else if (inputFile.endsWith('.jsonl') || inputFile.endsWith('.ndjson')) {
        format = 'jsonl';
      } else {
        format = 'har';
      }
    }

    const customMapping: Record<string, string> = {};
    if (values.map && values.map.length > 0) {
      for (const mapPair of values.map) {
        const [target, source] = mapPair.split('=');
        if (target && source) {
          customMapping[target.trim()] = source.trim();
        }
      }
    }

    let loaderResult;
    if (format === 'jsonl') {
      loaderResult = await loadJsonl(resolvedInput, { mapping: customMapping });
    } else {
      loaderResult = loadHar(resolvedInput);
    }

    const maxSamplesNum = Number(values['max-samples']) || 5;

    const spec = buildMockSpec(loaderResult.entries, {
      host: values.host,
      include: values.include,
      exclude: values.exclude,
      maxSamples: maxSamplesNum,
      includeStatic: values['include-static'],
      mask: {
        unsafeDisableMasking: values['unsafe-no-mask'],
        allowKeys: values['allow-key'],
        denyKeys: values['deny-key'],
      },
    });

    const outDir = resolve(process.cwd(), values.out || './mocks');
    mkdirSync(outDir, { recursive: true });
    const outFilePath = join(outDir, 'mock-spec.json');
    writeFileSync(outFilePath, JSON.stringify(spec, null, 2), 'utf-8');

    const totalSamples = spec.routes.reduce((acc, r) => acc + r.samples.length, 0);

    console.log(`[mock-from-logs] Mock spec generated successfully!`);
    console.log(`  Input:        ${inputFile}`);
    console.log(`  Output:       ${outFilePath}`);
    console.log(`  Format:       ${format.toUpperCase()}`);
    console.log(`  Entries read: ${loaderResult.totalCount}`);
    console.log(`  Skipped:      ${loaderResult.skippedCount}`);
    console.log(`  Routes:       ${spec.routes.length}`);
    console.log(`  Samples:      ${totalSamples}`);
    console.log(
      `  Masking:      ${values['unsafe-no-mask'] ? 'DISABLED (--unsafe-no-mask)' : 'ENABLED'}`,
    );
    return;
  }

  if (command === 'serve') {
    const { values, positionals } = parseArgs({
      args: commandArgs,
      options: {
        port: { type: 'string', default: '4000' },
        host: { type: 'string', default: '127.0.0.1' },
        delay: { type: 'string', default: '0' },
      },
      allowPositionals: true,
    });

    const specFilePath = resolveSpecPath(positionals[0]);
    const specContent = readFileSync(specFilePath, 'utf-8');
    const spec = JSON.parse(specContent) as MockSpec;

    const portNum = Number(values.port) || 4000;
    const delayNum = Number(values.delay) || 0;

    const serverInstance = await startMockServer(spec, {
      port: portNum,
      host: values.host,
      delayMs: delayNum,
    });

    console.log(`[mock-from-logs] Mock server listening at ${serverInstance.url}`);
    console.log(`Routes (${spec.routes.length}):`);
    for (const route of spec.routes) {
      console.log(
        `  ${route.method.padEnd(7)} ${route.path} (${route.samples.length} sample${route.samples.length === 1 ? '' : 's'})`,
      );
    }
    console.log(`Press Ctrl+C to stop.`);

    const shutdown = async () => {
      console.log(`\n[mock-from-logs] Shutting down mock server...`);
      await serverInstance.close();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    return;
  }

  if (command === 'msw') {
    const { values, positionals } = parseArgs({
      args: commandArgs,
      options: {
        out: { type: 'string', default: './handlers.ts' },
      },
      allowPositionals: true,
    });

    const specFilePath = resolveSpecPath(positionals[0]);
    const specContent = readFileSync(specFilePath, 'utf-8');
    const spec = JSON.parse(specContent) as MockSpec;

    const mswCode = generateMswHandlers(spec);
    const outPath = resolve(process.cwd(), values.out || './handlers.ts');
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, mswCode, 'utf-8');

    console.log(`[mock-from-logs] MSW v2 handlers written to ${outPath}`);
    return;
  }

  throw new Error(`Unknown command "${command}". Run "mock-from-logs --help" for usage.`);
}

// Auto-run if executed directly as entrypoint
if (
  import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` ||
  process.argv[1]?.endsWith('cli.js') ||
  process.argv[1]?.endsWith('cli.ts')
) {
  runCli().catch((err: Error) => {
    console.error(`[mock-from-logs] Error: ${err.message}`);
    process.exit(1);
  });
}
