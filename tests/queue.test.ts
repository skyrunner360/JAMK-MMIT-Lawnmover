import { expect, test } from 'bun:test';
import { SerialQueue } from '../src/lib/server/mower/queue';

test('serializes writes and publishes only after each write finishes', async () => {
	const result: number[] = [];
	const queue = new SerialQueue(3);
	const first = queue.add(async () => {
		await Bun.sleep(10);
		result.push(1);
	});
	const second = queue.add(async () => {
		result.push(2);
	});
	await Promise.all([first, second]);
	expect(result).toEqual([1, 2]);
	expect(queue.pending).toBe(0);
});
test('a failed write prevents later queued work', async () => {
	const queue = new SerialQueue(3);
	let executed = false;
	const result = await Promise.allSettled([
		queue.add(async () => {
			throw new Error('database offline');
		}),
		queue.add(async () => {
			executed = true;
		})
	]);
	expect(result.map((r) => r.status)).toEqual(['rejected', 'rejected']);
	expect(executed).toBe(false);
	expect(queue.failure).not.toBeNull();
});
test('rejects overflow rather than silently dropping writes', async () => {
	const queue = new SerialQueue(1);
	const first = queue.add(async () => {
		await Bun.sleep(10);
	});
	await expect(queue.add(async () => {})).rejects.toThrow('full');
	await first;
});
