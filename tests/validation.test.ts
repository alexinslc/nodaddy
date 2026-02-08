import { describe, it, expect } from 'vitest';
import { assertValidDomain } from '../src/services/validation.js';

describe('assertValidDomain', () => {
  it('accepts simple domains', () => {
    expect(() => assertValidDomain('example.com')).not.toThrow();
    expect(() => assertValidDomain('sub.example.com')).not.toThrow();
    expect(() => assertValidDomain('a.b.c.d.example.com')).not.toThrow();
  });

  it('accepts domains with hyphens', () => {
    expect(() => assertValidDomain('my-site.example.com')).not.toThrow();
    expect(() => assertValidDomain('a-b-c.example.com')).not.toThrow();
  });

  it('accepts single-label domains', () => {
    expect(() => assertValidDomain('localhost')).not.toThrow();
  });

  it('accepts domains with numbers', () => {
    expect(() => assertValidDomain('123.example.com')).not.toThrow();
    expect(() => assertValidDomain('site2.example.com')).not.toThrow();
  });

  it('rejects empty string', () => {
    expect(() => assertValidDomain('')).toThrow('Invalid domain name');
  });

  it('rejects domains over 253 characters', () => {
    const long = 'a'.repeat(250) + '.com';
    expect(() => assertValidDomain(long)).toThrow('Invalid domain name');
  });

  it('rejects labels over 63 characters', () => {
    const longLabel = 'a'.repeat(64) + '.com';
    expect(() => assertValidDomain(longLabel)).toThrow('Invalid domain name');
  });

  it('accepts labels exactly 63 characters', () => {
    const label63 = 'a'.repeat(63) + '.com';
    expect(() => assertValidDomain(label63)).not.toThrow();
  });

  it('rejects domains with path traversal', () => {
    expect(() => assertValidDomain('../admin')).toThrow('Invalid domain name');
    expect(() => assertValidDomain('example.com/../../etc')).toThrow('Invalid domain name');
  });

  it('rejects domains with spaces', () => {
    expect(() => assertValidDomain('example .com')).toThrow('Invalid domain name');
  });

  it('rejects domains with special characters', () => {
    expect(() => assertValidDomain('example!.com')).toThrow('Invalid domain name');
    expect(() => assertValidDomain('example@.com')).toThrow('Invalid domain name');
    expect(() => assertValidDomain('example$.com')).toThrow('Invalid domain name');
  });

  it('rejects labels starting or ending with hyphens', () => {
    expect(() => assertValidDomain('-example.com')).toThrow('Invalid domain name');
    expect(() => assertValidDomain('example-.com')).toThrow('Invalid domain name');
  });

  it('rejects empty labels (double dots)', () => {
    expect(() => assertValidDomain('example..com')).toThrow('Invalid domain name');
  });

  it('rejects trailing dot (empty label)', () => {
    expect(() => assertValidDomain('example.com.')).toThrow('Invalid domain name');
  });
});
