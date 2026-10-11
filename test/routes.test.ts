import { describe, it, expect } from 'vitest';
import {
  inferRoute,
  normalizePath,
  extractHost,
  matchRoute,
  getRouteSpecificity,
  isDynamicSegment,
} from '../src/routes.js';

describe('Route inference and matching', () => {
  it('normalizes pathnames correctly', () => {
    expect(normalizePath('')).toBe('/');
    expect(normalizePath('https://api.example.com/users/')).toBe('/users');
    expect(normalizePath('/users/me?foo=bar#hash')).toBe('/users/me');
    expect(normalizePath('/')).toBe('/');
  });

  it('extracts host from full URL', () => {
    expect(extractHost('https://api.example.com/users')).toBe('api.example.com');
    expect(extractHost('http://localhost:3000/test')).toBe('localhost:3000');
    expect(extractHost('/users')).toBeUndefined();
  });

  it('detects dynamic segments', () => {
    // Numeric
    expect(isDynamicSegment('123')).toBe(true);
    // UUID
    expect(isDynamicSegment('8f3b6c2a-9e1d-4f7b-8c3a-2e4d5f6a7b8c')).toBe(true);
    // ULID
    expect(isDynamicSegment('01ARZ3NDEKTSV4RRFFQ69G5FAV')).toBe(true);
    // Hex 16+
    expect(isDynamicSegment('0123456789abcdef0123')).toBe(true);
    // Email or percent encoded
    expect(isDynamicSegment('user@example.com')).toBe(true);
    expect(isDynamicSegment('user%40example.com')).toBe(true);
    // Fixed words
    expect(isDynamicSegment('me')).toBe(false);
    expect(isDynamicSegment('users')).toBe(false);
    expect(isDynamicSegment('profile')).toBe(false);
  });

  it('collapses dynamic segments into sequential :id, :id2, :id3', () => {
    expect(inferRoute('https://api.example.com/users/123')).toBe('/users/:id');
    expect(inferRoute('/users/8f3b6c2a-9e1d-4f7b-8c3a-2e4d5f6a7b8c')).toBe('/users/:id');
    expect(inferRoute('/users/01ARZ3NDEKTSV4RRFFQ69G5FAV')).toBe('/users/:id');
    expect(inferRoute('/orgs/123/users/456/roles/789')).toBe('/orgs/:id/users/:id2/roles/:id3');
    expect(inferRoute('/users/alice@example.com')).toBe('/users/:id');
    expect(inferRoute('/users/alice%40example.com/settings')).toBe('/users/:id/settings');
  });

  it('preserves fixed words and ignores trailing slashes', () => {
    expect(inferRoute('/users/me')).toBe('/users/me');
    expect(inferRoute('/users/me/')).toBe('/users/me');
    expect(inferRoute('/')).toBe('/');
  });

  it('supports extra user regexes', () => {
    const extraRegexes = [/^TICKET-\d+$/];
    expect(inferRoute('/support/TICKET-42', { extraRegexes })).toBe('/support/:id');
    expect(inferRoute('/support/TICKET-42')).toBe('/support/TICKET-42');
  });

  it('calculates specificity: fixed routes score higher than parameterized routes', () => {
    const fixedSpec = getRouteSpecificity('/users/me');
    const paramSpec = getRouteSpecificity('/users/:id');
    expect(fixedSpec.fixedCount).toBe(2);
    expect(paramSpec.fixedCount).toBe(1);
    expect(fixedSpec.specificityScore).toBeGreaterThan(paramSpec.specificityScore);
  });

  it('matches routes and extracts params', () => {
    const m1 = matchRoute('/users/123', '/users/:id');
    expect(m1.matched).toBe(true);
    expect(m1.params).toEqual({ id: '123' });

    const m2 = matchRoute('/users/123/posts/456', '/users/:id/posts/:id2');
    expect(m2.matched).toBe(true);
    expect(m2.params).toEqual({ id: '123', id2: '456' });

    const m3 = matchRoute('/users/123', '/orders/:id');
    expect(m3.matched).toBe(false);
  });
});
