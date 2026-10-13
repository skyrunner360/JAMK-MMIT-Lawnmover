import { expect, test } from 'bun:test';
import { createEventStream } from '../src/lib/server/mower/stream';

test('sends snapshot first and removes subscriptions on cancellation', async () => {
	let listener: ((message: unknown) => void) | undefined;
	let removed = 0;
	const source = {
		snapshot: () => ({ reading: null }),
		subscribe: (fn: (message: unknown) => void) => {
			listener = fn;
			return () => {
				removed++;
			};
		}
	};
	const response = createEventStream(source, new AbortController().signal);
	const reader = response.body!.getReader();
	const decoder = new TextDecoder();
	expect(decoder.decode((await reader.read()).value)).toContain('"type":"snapshot"');
	listener!({ type: 'reading', data: { battery_pct: 90 } });
	expect(decoder.decode((await reader.read()).value)).toContain('"battery_pct":90');
	await reader.cancel();
	expect(removed).toBe(1);
});
test('aborted requests close and unsubscribe exactly once', async () => {
	const abort = new AbortController();
	let removed = 0;
	const response = createEventStream(
		{
			snapshot: () => null,
			subscribe: () => () => {
				removed++;
			}
		},
		abort.signal
	);
	const reader = response.body!.getReader();
	await reader.read();
	abort.abort();
	expect((await reader.read()).done).toBe(true);
	expect(removed).toBe(1);
});
test('slow clients are disconnected instead of accumulating unlimited telemetry', async () => {
	let send: (m: unknown) => void = () => {};
	let removed = 0;
	const response = createEventStream(
		{
			snapshot: () => null,
			subscribe: (fn) => {
				send = fn;
				return () => {
					removed++;
				};
			}
		},
		new AbortController().signal
	);
	for (let i = 0; i < 100; i++) send({ type: 'reading', data: i });
	expect(removed).toBe(1);
	await expect(response.body!.getReader().read()).rejects.toThrow('Slow');
});
