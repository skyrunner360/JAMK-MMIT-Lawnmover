import { expect, test } from 'bun:test';
import { createHttpSink } from '../src/lib/sim/http-sink.js';
test('HTTP sink sends bearer credentials and awaits messages in order', async () => {
	const seen: number[] = [];
	const sink = createHttpSink(
		'http://local/api/ingest',
		'test-token',
		() => {},
		async (_url, init) => {
			expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test-token');
			const { data } = JSON.parse(String(init?.body));
			if (data === 1) await Bun.sleep(10);
			seen.push(data);
			return new Response('{}');
		}
	);
	sink({ type: 'reading', data: 1 });
	sink({ type: 'reading', data: 2 });
	await sink.flush();
	expect(seen).toEqual([1, 2]);
});
test('HTTP rejection stops the sink and rejects flush instead of losing data silently', async () => {
	let stopped = false;
	const sink = createHttpSink(
		'http://local',
		'token',
		() => {
			stopped = true;
		},
		async () => new Response('', { status: 401 })
	);
	sink({ type: 'reading', data: 1 });
	await expect(sink.flush()).rejects.toThrow('401');
	expect(stopped).toBe(true);
});
