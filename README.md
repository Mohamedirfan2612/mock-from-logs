# mock-from-logs

> Turn recorded API traffic into a runnable mock API, so frontend developers can keep shipping when backend services are down, incomplete, or behind a firewall.

`mock-from-logs` ingests browser HAR 1.2 recordings ("Save all as HAR with content") or JSON-lines application logs containing response bodies and turns them into a clean, deterministic mock specification, a zero-dependency standalone mock HTTP server, or Mock Service Worker (MSW v2) request handlers. Personal data, passwords, and sensitive authentication tokens are automatically masked by default.

---

## Features

- **Zero Runtime Dependencies**: Powered entirely by Node.js built-ins (`node:http`, `node:readline`, `node:crypto`, `node:util`).
- **Automatic Route Parameterization**: Intelligently collapses numeric IDs, UUIDs, ULIDs, hex hashes, and email segments into clean REST parameters (`/users/:id`, `/users/:id/posts/:id2`), while preserving static keywords like `/users/me`.
- **Privacy & Security First**: PII and secrets (passwords, tokens, API keys, emails, phone numbers, JWTs, Bearer headers) are automatically redacted before mock specs are written.
- **Multiple Output Formats**: Generate reusable JSON mock specs, run a standalone CORS-enabled local server, or export ready-to-use MSW v2 TypeScript handlers.
- **Dynamic Simulation**: Automatic rotation through recorded 2xx samples and forced status codes via `?__mock_status=` or `x-mock-status`.

---

## Quick Start

### 1. Record Network Traffic

In Chrome, Edge, or Firefox DevTools:

1. Open the **Network** tab and interact with your application.
2. Right-click any request in the network list.
3. Select **"Save all as HAR with content"** and save the file as `traffic.har`.

### 2. Generate Mock Specification

Run the CLI to parse and sanitize the traffic:

```bash
npx mock-from-logs generate traffic.har --out ./mocks
```

This generates `./mocks/mock-spec.json` with all endpoints inferred and secrets masked.

### 3. Run the Mock Server

Start the local mock server:

```bash
npx mock-from-logs serve ./mocks/mock-spec.json --port 4000
```

Your mock server is now live at `http://127.0.0.1:4000`.

---

## Automatic Data Masking

Sensitive data redaction is enabled by default to prevent accidental leaks of customer data, passwords, and tokens.

| Target Data               | Rule / Pattern                                                                                                                                             | Replacement                                |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| **Sensitive Keys**        | Normalized key contains: `password`, `passwd`, `secret`, `token`, `apikey`, `authorization`, `privatekey`, `ssn`, `creditcard`, `cardnumber`, `cvv`, `cvc` | `"[REDACTED]"`                             |
| **Email Addresses**       | Value, key, or path matching email pattern (e.g. `john.doe@example.com` or `john%40example.com`)                                                           | `user_<hash8>@example.com` (deterministic) |
| **Phone Numbers**         | International `+...`, `(xxx) xxx-xxxx`, `xxx-xxx-xxxx`                                                                                                     | `+1555xxxxxxx` (deterministic)             |
| **JSON Web Tokens (JWT)** | `ey... . ey... . ...` header/payload/signature format                                                                                                      | `"[REDACTED_JWT]"`                         |
| **Bearer Tokens**         | `Bearer <token>` in strings                                                                                                                                | `"Bearer [REDACTED]"`                      |
| **Metadata Protection**   | Request headers, request bodies, cookies, and query strings                                                                                                | **Never stored in spec**                   |
| **Preserved Values**      | ISO 8601 timestamps, dates (`YYYY-MM-DD`), plain numbers                                                                                                   | Unchanged                                  |

> **Note:** To disable masking for local debugging, use the explicitly named `--unsafe-no-mask` flag (or `unsafeDisableMasking: true` in the programmatic API). A loud warning will be displayed in the terminal.

---

## CLI Reference

### `generate <input>`

Converts a HAR 1.2 file or JSONL log into a `mock-spec.json` file.

```bash
mock-from-logs generate <input> [options]
```

**Options:**

- `--out <dir>`: Target directory for `mock-spec.json` (default: `./mocks`)
- `--format <har|jsonl>`: Input format (auto-detected from file extension if omitted)
- `--host <hostname>`: Filter traffic to a specific host (e.g. `api.example.com`)
- `--include <prefix>`: Include routes matching prefix (can be specified multiple times)
- `--exclude <prefix>`: Exclude routes matching prefix (can be specified multiple times)
- `--max-samples <num>`: Max sample responses per route & status (default: `5`)
- `--include-static`: Include static assets like `.js`, `.css`, and images (skipped by default)
- `--allow-key <key>`: Whitelist a key from redaction (can be specified multiple times)
- `--deny-key <key>`: Force redaction on an additional key (can be specified multiple times)
- `--map <target=path>`: Custom JSONL field mapping (can be specified multiple times)
- `--unsafe-no-mask`: Disable automatic PII and credential masking

### `serve <spec-dir | spec.json>`

Runs a local HTTP server serving recorded responses.

```bash
mock-from-logs serve ./mocks/mock-spec.json [options]
```

**Options:**

- `--port <port>`: Port to bind to (default: `4000`)
- `--host <host>`: Host interface to bind to (default: `127.0.0.1`)
- `--delay <ms>`: Artificial response latency in milliseconds (default: `0`)

**Runtime Features:**

- **Sample Rotation**: Subsequent calls to the same endpoint rotate through recorded 2xx samples.
- **Forced Status**: Override the response status by passing `?__mock_status=404` or the `x-mock-status: 404` header. If no sample was recorded for that status code, a structured JSON error response is returned.
- **Route Specificity**: Exact routes (e.g. `/users/me`) always take priority over parameterized routes (`/users/:id`).
- **CORS Handling**: Automatic preflight `OPTIONS` handling with permissive CORS headers.

### `msw <spec-dir | spec.json>`

Emits a TypeScript module exporting Mock Service Worker (MSW v2) request handlers.

```bash
mock-from-logs msw ./mocks/mock-spec.json --out ./src/mocks/handlers.ts
```

---

## JSONL Custom Field Mapping

If your application logs HTTP traffic to JSON-lines (e.g. via Bunyan, Pino, or custom middleware), `mock-from-logs` can stream and ingest them.

Default field names expected:

- `method`: HTTP method
- `url`: Request URL or path
- `status`: HTTP status code
- `contentType`: MIME type
- `responseBody`: Recorded response payload (JSON object or string)

To map custom or nested log properties, use the `--map` option:

```bash
mock-from-logs generate backend.jsonl \
  --map method=req.method \
  --map url=req.path \
  --map status=res.statusCode \
  --map responseBody=res.body
```

---

## Programmatic API

Install `mock-from-logs` as a development dependency:

```bash
npm install -D mock-from-logs
```

### Building a Mock Spec

```typescript
import { loadHar, buildMockSpec } from 'mock-from-logs';

const { entries, skippedCount } = loadHar('./traffic.har');

const spec = buildMockSpec(entries, {
  host: 'api.example.com',
  include: ['/api/v1'],
  maxSamples: 3,
  mask: {
    allowKeys: ['publicToken'],
  },
});
```

### Starting the Mock Server

```typescript
import { startMockServer } from 'mock-from-logs';

const server = await startMockServer(spec, {
  port: 4000,
  host: '127.0.0.1',
  delayMs: 50,
});

console.log(`Server running at ${server.url}`);

// Clean shutdown when finished
await server.close();
```

### Generating MSW Handlers

```typescript
import { generateMswHandlers } from 'mock-from-logs';
import { writeFileSync } from 'node:fs';

const code = generateMswHandlers(spec);
writeFileSync('./src/mocks/handlers.ts', code);
```

---

## Limitations

Please review these known limitations:

1. **Access Logs vs Response Logs**: Standard web server access logs (like default Nginx or Apache combined logs) record only request URLs and status codes without response bodies. `mock-from-logs` requires response bodies to generate functioning mocks.
2. **Path-Only Routing**: Route inference matches on HTTP method and path hierarchy. Query parameters and request bodies are not factored into route identity.
3. **No Stateful Auth or Business Logic**: Mocks replay captured responses. Dynamic auth state (e.g. CSRF tokens, OAuth redirects, stateful database mutations) is not executed.
4. **No WebSockets or Binary Streaming**: Only standard HTTP request/response exchanges are supported. Binary bodies (images, PDFs, binary streams) are dropped.
5. **Pattern-Based Masking**: Masking uses heuristic pattern matching and normalized key lists. It is not an absolute cryptographic DLP guarantee. Review your generated mock specs before committing them to public repositories.

---

## Roadmap

- [ ] Interactive CLI mode for approving route inference and sample selection
- [ ] Schema inference (JSON Schema / OpenAPI 3.1) from aggregated response samples
- [ ] GraphQL query name and operation route inference
- [ ] Har entry filter by date/time window
- [ ] Custom response transforms via plugin scripts

---

## Contributing

Contributions and bug reports are welcome! Please check out [CONTRIBUTING.md](./CONTRIBUTING.md) for local development instructions.

---

## License

[MIT](./LICENSE) &copy; 2026 mohamedirfan-26
