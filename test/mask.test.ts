import { describe, it, expect, vi } from 'vitest';
import { resolve } from 'node:path';
import {
  deterministicEmail,
  deterministicPhone,
  isSensitiveKey,
  maskData,
  maskString,
  maskValue,
} from '../src/mask.js';
import { loadHar } from '../src/har.js';
import { buildMockSpec } from '../src/spec.js';

describe('Masking', () => {
  it('identifies sensitive keys with normalization', () => {
    expect(isSensitiveKey('password')).toBe(true);
    expect(isSensitiveKey('user_password')).toBe(true);
    expect(isSensitiveKey('PASSWD')).toBe(true);
    expect(isSensitiveKey('clientSecret')).toBe(true);
    expect(isSensitiveKey('api_key')).toBe(true);
    expect(isSensitiveKey('access_token')).toBe(true);
    expect(isSensitiveKey('Authorization')).toBe(true);
    expect(isSensitiveKey('private_key_pem')).toBe(true);
    expect(isSensitiveKey('user_ssn')).toBe(true);
    expect(isSensitiveKey('credit-card-number')).toBe(true);
    expect(isSensitiveKey('card_number')).toBe(true);
    expect(isSensitiveKey('cvv2')).toBe(true);
    expect(isSensitiveKey('cvc')).toBe(true);

    expect(isSensitiveKey('username')).toBe(false);
    expect(isSensitiveKey('id')).toBe(false);
    expect(isSensitiveKey('title')).toBe(false);
  });

  it('honors allowKeys and denyKeys', () => {
    // Allowed key is not sensitive even if it matches sensitive pattern
    expect(isSensitiveKey('public_token', { allowKeys: ['public_token'] })).toBe(false);
    // Denied key is marked sensitive even if normally not
    expect(isSensitiveKey('internal_id', { denyKeys: ['internal_id'] })).toBe(true);
  });

  it('produces deterministic email and phone replacements', () => {
    const e1 = deterministicEmail('test.user@example.com');
    const e2 = deterministicEmail('TEST.USER@EXAMPLE.COM');
    expect(e1).toBe(e2);
    expect(e1).toMatch(/^user_[0-9a-f]{8}@example\.com$/);

    const p1 = deterministicPhone('+1-202-555-0199');
    const p2 = deterministicPhone('+1 202 555 0199');
    expect(p1).toBe(p2);
    expect(p1).toMatch(/^\+1555\d{7}$/);
  });

  it('masks emails, phones, JWTs and Bearer tokens in strings', () => {
    expect(maskString('Contact me at bob@corp.org')).toMatch(
      /^Contact me at user_[0-9a-f]{8}@example\.com$/,
    );
    expect(maskString('URL: /users/bob%40corp.org/profile')).toMatch(
      /^URL: \/users\/user_[0-9a-f]{8}@example\.com\/profile$/,
    );

    expect(maskString('Call +1 202 555 0144 now')).toMatch(/^Call \+1555\d{7} now$/);
    expect(maskString('Call (555) 123-4567')).toMatch(/^Call \+1555\d{7}$/);
    expect(maskString('Call 555-123-4567')).toMatch(/^Call \+1555\d{7}$/);

    const jwt = 'eyFakeHeader123456.eyFakePayload123456.FakeSignature123456';
    expect(maskString(`Token: ${jwt}`)).toBe('Token: [REDACTED_JWT]');

    expect(maskString('Authorization: Bearer my-secret-token-xyz')).toBe(
      'Authorization: Bearer [REDACTED]',
    );
  });

  it('preserves ISO timestamps, dates, and plain numbers', () => {
    expect(maskString('2026-10-11T14:47:10.000Z')).toBe('2026-10-11T14:47:10.000Z');
    expect(maskString('2026-10-11')).toBe('2026-10-11');
    expect(maskValue(1234567890123)).toBe(1234567890123);
  });

  it('never mutates input objects and masks nested objects, keys, and values', () => {
    const original = {
      'alice@example.com': {
        password: 'cleartext_password',
        contact: {
          phone: '+44 20 7946 0958',
          registeredAt: '2026-05-20T12:00:00Z',
        },
      },
    };

    const cloned = JSON.parse(JSON.stringify(original));
    const result = maskData(original) as Record<
      string,
      { password: string; contact: { phone: string; registeredAt: string } }
    >;

    // Check original object untouched
    expect(original).toEqual(cloned);

    // Check masked output
    const keys = Object.keys(result);
    expect(keys[0]).toMatch(/^user_[0-9a-f]{8}@example\.com$/);
    const userObj = result[keys[0]!];
    expect(userObj?.password).toBe('[REDACTED]');
    expect(userObj?.contact.phone).toMatch(/^\+1555\d{7}$/);
    expect(userObj?.contact.registeredAt).toBe('2026-05-20T12:00:00Z');
  });

  it('guards against circular references and deep nesting', () => {
    const circular: { name: string; self?: unknown } = { name: 'cyclic' };
    circular.self = circular;

    const res = maskValue(circular) as { name: string; self: unknown };
    expect(res.name).toBe('cyclic');
    expect(res.self).toBe('[CIRCULAR]');

    let deep: { val?: string; child?: unknown } = { val: 'deep' };
    for (let i = 0; i < 60; i++) {
      deep = { child: deep };
    }
    const deepResult = maskValue(deep);
    expect(JSON.stringify(deepResult)).toContain('[MAX_DEPTH_EXCEEDED]');
  });

  it('warns when unsafeDisableMasking is set and leaves data unmasked', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sensitive = { password: 'secretpassword123' };
    const result = maskData(sensitive, { unsafeDisableMasking: true });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('unsafeDisableMasking'));
    expect(result.password).toBe('secretpassword123');
    warnSpy.mockRestore();
  });

  it('asserts that every fake secret from sample.har is absent in the built spec', () => {
    const harPath = resolve(__dirname, 'fixtures/sample.har');
    const { entries } = loadHar(harPath);
    const spec = buildMockSpec(entries);
    const serialized = JSON.stringify(spec);

    const secrets = [
      'fake.developer@example.org',
      'alice.fake@example.com',
      'contact@example.org',
      '+1-555-234-5678',
      '(555) 987-6543',
      '555-432-1098',
      'fake-api-key-xyz-987654',
      'eyFakeHeader123456.eyFakePayload123456.FakeSignature123456',
      'super-secret-password',
      'secret-auth-header-999',
      'cookie-session-secret-888',
      'query-secret-token-123',
      'internal-secret-999',
      '4111-2222-3333-4444',
      'SuperSecretPayload',
    ];

    for (const secret of secrets) {
      expect(serialized).not.toContain(secret);
    }
  });
});
