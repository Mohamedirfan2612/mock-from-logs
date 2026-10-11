# Contributing to mock-from-logs

Thank you for your interest in contributing to `mock-from-logs`!

## Code of Conduct

Please be polite, respectful, and constructive in all interactions.

## Prerequisites

- Node.js >= 18
- npm

## Development Workflow

1. Fork and clone the repository.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run tests during development:
   ```bash
   npm test
   ```
4. Run test coverage:
   ```bash
   npm run test:coverage
   ```
5. Check types and linting:
   ```bash
   npm run typecheck
   npm run lint
   ```
6. Format code:
   ```bash
   npm run format:write
   ```
7. Verify build:
   ```bash
   npm run build
   ```

## Rules & Philosophy

- **Zero Runtime Dependencies**: The package must remain dependency-free at runtime. Use Node.js built-in modules (`node:http`, `node:fs`, `node:util`, `node:crypto`, `node:readline`).
- **Fake Data Only**: Never commit real traffic, sensitive customer data, or live credentials in tests, fixtures, or examples.
- **Strict Typing**: TypeScript strict mode must pass without errors.
