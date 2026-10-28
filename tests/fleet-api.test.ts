import { expect, test } from 'bun:test';
import { parseTrendRange } from '../src/lib/server/mower/fleet-validation';
import { hashToken, newCredential } from '../src/lib/server/mower/fleet';
test('trend ranges reject impossible, reversed, excessive or unbounded dates', () => {
	expect(() => parseTrendRange(new URLSearchParams('from=2026-02-30&to=2026-03-01'))).toThrow();
	expect(() => parseTrendRange(new URLSearchParams('from=2026-10-01&to=2026-09-01'))).toThrow();
	expect(() => parseTrendRange(new URLSearchParams('from=2024-01-01&to=2026-01-01'))).toThrow();
	expect(() => parseTrendRange(new URLSearchParams())).toThrow();
	expect(parseTrendRange(new URLSearchParams('from=2026-10-01&to=2026-10-28')).from).toBe(
		'2026-10-01'
	);
});
test('provisioned credentials are random and stored as hashes', () => {
	const a = newCredential(),
		b = newCredential();
	expect(a.token).not.toBe(b.token);
	expect(a.token_hash).toBe(hashToken(a.token));
	expect(a.token_hash).not.toContain(a.token);
});
