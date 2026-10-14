import { expect, test } from 'bun:test';
import { readJson, requireIngestToken } from '../src/lib/server/mower/http';

test('API guards reject incorrect ingestion tokens', () => {
	expect(() => requireIngestToken(new Headers(), 'secret')).toThrow();
	expect(() =>
		requireIngestToken(new Headers({ authorization: 'Bearer wrong' }), 'secret')
	).toThrow();
	expect(() =>
		requireIngestToken(new Headers({ authorization: 'Bearer secret' }), 'secret')
	).not.toThrow();
	expect(() => requireIngestToken(new Headers(), undefined)).toThrow();
});
test('JSON reader rejects malformed and oversized payloads', async () => {
	await expect(
		readJson(
			new Request('http://local', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: '{'
			})
		)
	).rejects.toThrow();
	await expect(
		readJson(
			new Request('http://local', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ value: 'a'.repeat(300000) })
			})
		)
	).rejects.toThrow();
	expect(
		await readJson(
			new Request('http://local', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: '{"action":"stop"}'
			})
		)
	).toEqual({ action: 'stop' });
});
test('API rejects cross-origin mutations', async () => {
	const { api } = await import('../src/lib/server/mower/http');
	let executed = false;
	const handler = api(async () => {
		executed = true;
		return new Response('{}');
	});
	const response = await handler({
		locals: { user: {} },
		url: new URL('http://local/api/simulator'),
		request: new Request('http://local/api/simulator', {
			method: 'POST',
			headers: { origin: 'https://untrusted.example' }
		})
	} as any);
	expect(response.status).toBe(403);
	expect(executed).toBe(false);
});
