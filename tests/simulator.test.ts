import { expect, test } from 'bun:test';
import { MowerSimulator } from '../src/lib/server/mower-simulator.js';
import { parseMessage } from '../src/lib/server/mower/validation';

test('demo dataset generates valid readings, events, completed sessions and zones', async () => {
	const sim = new MowerSimulator({ speed: Infinity, sessions: 1, gapSeconds: 0, seed: 42 });
	const types = new Set<string>();
	let readings = 0;
	sim.on('message', (message: unknown) => {
		const parsed = parseMessage(message);
		types.add(parsed.type);
		if (parsed.type === 'reading') readings++;
	});
	await sim.start();
	expect(readings).toBeGreaterThan(100);
	expect([...types].sort()).toEqual(['event', 'reading', 'session_end', 'session_start', 'zones']);
	expect(sim.snapshot().zones.length).toBe(26);
});
test('stop and restart continues without replaying the session start or skipping a reading', async () => {
	const sim = new MowerSimulator({ speed: 1000, sessions: 1, gapSeconds: 0, seed: 1 });
	let starts = 0;
	const timestamps: string[] = [];
	sim.on('message', (m: any) => {
		if (m.type === 'session_start') starts++;
		if (m.type === 'reading') {
			timestamps.push(m.data.timestamp);
			sim.stop();
		}
	});
	await sim.start();
	await sim.start();
	expect(starts).toBe(1);
	expect(timestamps.length).toBe(2);
	expect(Date.parse(timestamps[1] + 'Z') - Date.parse(timestamps[0] + 'Z')).toBe(10000);
});
test('generated bearing wear stays valid across several synthetic sessions', async () => {
	const sim = new MowerSimulator({ speed: Infinity, sessions: 5, gapSeconds: 0, seed: 7 });
	let ends = 0;
	sim.on('message', (m: unknown) => {
		if (parseMessage(m).type === 'session_end') ends++;
	});
	await sim.start();
	expect(ends).toBe(5);
});
