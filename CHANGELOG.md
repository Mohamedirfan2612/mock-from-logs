# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-10-11

### Added

- **Core loaders**:
  - HAR 1.2 reader with base64 decoding for textual content, binary payload filtering, JSON parsing, and malformed entry tracking.
  - Streaming JSON-lines reader with dotted field path support (`--map`) and flexible body decoding.
- **Route inference**:
  - Automatic parameterization of numeric IDs, UUIDs, ULIDs, hex IDs (16+ chars), and email segments into `:id`, `:id2`, `:id3`.
  - Fixed-word preservation (e.g. `/users/me`) and custom regex support.
- **Data masking**:
  - Automatic redaction of sensitive credentials (passwords, secrets, tokens, API keys, private keys, SSNs, credit cards, CVVs).
  - Deterministic masking for emails (`user_<hash8>@example.com`) and phone numbers (`+1555xxxxxxx`).
  - Redaction of JWTs and Bearer tokens.
  - Recursion depth and circular reference guards.
- **Spec builder**:
  - Filtering by host, include prefixes, exclude prefixes, and static assets.
  - Sample rotation capping, deduplication, and deterministic sorting.
- **Standalone mock server**:
  - Zero-dependency `node:http` server with CORS preflight support, route specificity ranking, 2xx sample rotation, and status override (`?__mock_status=` or `x-mock-status`).
- **MSW v2 generator**:
  - TypeScript code generation for MSW v2 (`handlers`) with wildcard origins, sample rotation, and status overrides.
- **CLI**:
  - `generate`, `serve`, and `msw` commands using `node:util.parseArgs`.
