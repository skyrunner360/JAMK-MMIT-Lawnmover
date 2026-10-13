import { expect, test } from 'bun:test';
const enabled = !!process.env.MOWER_TEST_URL;
const base = process.env.MOWER_TEST_URL ?? 'http://localhost:5173';
test.skipIf(!enabled)(
	'authenticated API stores and streams realtime readings to two clients',
	async () => {
		const anonymous = await fetch(base + '/api/readings');
		expect(anonymous.status).toBe(401);
		const health = await fetch(base + '/api/health');
		expect(health.status).toBe(200);
		const signup = await fetch(base + '/api/auth/sign-up/email', {
			method: 'POST',
			headers: { 'content-type': 'application/json', origin: base },
			body: JSON.stringify({
				name: 'Backend Test',
				email: `mower-${Date.now()}@example.com`,
				password: 'test-password-12345'
			})
		});
		expect(signup.status).toBe(200);
		const cookie = signup.headers
			.getSetCookie()
			.map((v) => v.split(';')[0])
			.join('; ');
		expect(cookie.length).toBeGreaterThan(0);
		const headers = { cookie, 'content-type': 'application/json', origin: base };
		const aborted = [new AbortController(), new AbortController()];
		const streams = await Promise.all(
			aborted.map((a) => fetch(base + '/api/stream', { headers, signal: a.signal }))
		);
		try {
			for (const stream of streams) expect(stream.status).toBe(200);
			const readers = streams.map((s) => s.body!.getReader());
			for (const reader of readers)
				expect(new TextDecoder().decode((await reader.read()).value)).toContain(
					'"type":"snapshot"'
				);
			await Bun.sleep(1300);
			const response = await fetch(base + '/api/readings?limit=2', { headers });
			expect(response.status).toBe(200);
			const result = await response.json();
			expect(result.data.length).toBe(2);
			const run = (await (await fetch(base + '/api/simulator', { headers })).json()).data.run_id;
			const sessions = await (
				await fetch(base + `/api/sessions?run_id=${run}`, { headers })
			).json();
			expect(sessions.data.length).toBe(1);
			const session = sessions.data[0];
			const detail = await fetch(base + `/api/sessions/${session.id}`, { headers });
			expect(detail.status).toBe(200);
			const zones = await (await fetch(base + '/api/zones', { headers })).json();
			expect(zones.data.length).toBe(26);
			expect((await fetch(base + '/api/readings?limit=999', { headers })).status).toBe(400);
			expect(
				(await fetch(base + '/api/sessions/00000000-0000-4000-8000-000000000000', { headers }))
					.status
			).toBe(404);
			expect(
				(await fetch(base + '/api/ingest', { method: 'POST', headers, body: '{}' })).status
			).toBe(401);
			const stopped = await fetch(base + '/api/simulator', {
				method: 'POST',
				headers,
				body: '{"action":"stop"}'
			});
			expect(stopped.status).toBe(200);
			expect((await stopped.json()).data.running).toBe(false);
		} finally {
			for (const a of aborted) a.abort();
			await fetch(base + '/api/simulator', { method: 'POST', headers, body: '{"action":"stop"}' });
		}
	},
	15000
);
