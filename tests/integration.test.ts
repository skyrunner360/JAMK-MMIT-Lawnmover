import { afterAll, expect, test } from 'bun:test';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { persistMessage } from '../src/lib/server/mower/repository';
import { parseMessage } from '../src/lib/server/mower/validation';
import { loadDataset } from '../src/lib/server/mower-simulator.js';

const enabled = process.env.RUN_DB_TESTS === '1';
const db = new PrismaClient();
const runs: string[] = [];
afterAll(async () => {
	if (enabled) {
		await db.simulationRun.deleteMany({ where: { id: { in: runs } } });
		await db.$disconnect();
	}
});
test.skipIf(!enabled)(
	'database ingestion is idempotent, preserves run isolation and completes sessions',
	async () => {
		const dataset = loadDataset();
		const start = {
			type: 'session_start',
			data: {
				session_id: 1,
				start_time: '2026-01-01 09:00:00',
				weather: 'sunny',
				bearing_wear: 0.1
			}
		};
		for (let i = 0; i < 2; i++) {
			const runId = randomUUID();
			runs.push(runId);
			await db.simulationRun.create({ data: { id: runId, source: 'test' } });
			await persistMessage(db, runId, parseMessage({ type: 'zones', data: dataset.zones.rows }));
			await persistMessage(db, runId, parseMessage(start));
			const reading = parseMessage({ type: 'reading', data: dataset.main.rows[0] });
			await persistMessage(db, runId, reading);
			await persistMessage(db, runId, reading);
			const event = parseMessage({ type: 'event', data: dataset.events.rows[0] });
			await persistMessage(db, runId, event);
			await persistMessage(db, runId, event);
			const end = parseMessage({ type: 'session_end', data: dataset.sessions.rows[0] });
			await persistMessage(db, runId, end);
			await persistMessage(db, runId, parseMessage(start));
			expect(await db.reading.count({ where: { session: { run_id: runId } } })).toBe(1);
			expect(await db.mowerEvent.count({ where: { session: { run_id: runId } } })).toBe(1);
			const session = await db.mowingSession.findFirstOrThrow({ where: { run_id: runId } });
			expect(session.end_time?.toISOString()).toBe('2026-01-01T09:08:10.000Z');
			await persistMessage(db, runId, parseMessage({ type: 'zones', data: dataset.zones.rows }));
			const zone = await db.zone.findUniqueOrThrow({
				where: { run_id_zone_id: { run_id: runId, zone_id: 1 } }
			});
			expect(zone.time_spent_s).toBe(10);
			expect(zone.obstacle_events).toBe(1);
		}
		expect(await db.mowingSession.count({ where: { run_id: { in: runs } } })).toBe(2);
	}
);
test.skipIf(!enabled)('unknown session rejects telemetry without partial writes', async () => {
	const id = randomUUID();
	runs.push(id);
	await db.simulationRun.create({ data: { id, source: 'test' } });
	const ds = loadDataset();
	await persistMessage(db, id, parseMessage({ type: 'zones', data: ds.zones.rows }));
	await expect(
		persistMessage(db, id, parseMessage({ type: 'reading', data: ds.main.rows[0] }))
	).rejects.toThrow('session_start');
	expect(await db.reading.count({ where: { session: { run_id: id } } })).toBe(0);
});

test.skipIf(!enabled)(
	'two subscribers share one persisted simulation and stop/start preserves history',
	async () => {
		const { MowerService } = await import('../src/lib/server/mower/service');
		const { MowerSimulator } = await import('../src/lib/server/mower-simulator.js');
		const service = new MowerService(
			db,
			() => new MowerSimulator({ speed: 100, seed: 42, fresh: true })
		);
		const seen1: string[] = [];
		const seen2: string[] = [];
		const listener = (target: string[]) => (m: any) => {
			if (m.type === 'reading') target.push(new Date(m.data.timestamp).toISOString());
		};
		const off1 = service.subscribe(listener(seen1));
		const off2 = service.subscribe(listener(seen2));
		try {
			await Promise.all([service.start(), service.start()]);
			runs.push(service.status().run_id!);
			await Bun.sleep(250);
			await service.stop();
			expect(seen1.length).toBeGreaterThanOrEqual(2);
			expect(seen1).toEqual(seen2);
			const count = await db.reading.count({
				where: { session: { run_id: service.status().run_id! } }
			});
			expect(count).toBe(seen1.length);
			await service.start();
			await Bun.sleep(120);
			await service.stop();
			expect(await db.mowingSession.count({ where: { run_id: service.status().run_id! } })).toBe(1);
			expect(new Set(seen1).size).toBe(seen1.length);
		} finally {
			off1();
			off2();
			await service.stop();
		}
	}
);

test.skipIf(!enabled)('persistence failure stops simulation and notifies subscribers', async () => {
	const { MowerService } = await import('../src/lib/server/mower/service');
	const { MowerSimulator } = await import('../src/lib/server/mower-simulator.js');
	const service = new MowerService(
		db,
		() => new MowerSimulator({ speed: 100, seed: 42, fresh: true })
	);
	let errors = 0;
	const off = service.subscribe((message) => {
		if (message.type === 'error') errors++;
	});
	try {
		await service.start();
		const runId = service.status().run_id!;
		await db.simulationRun.delete({ where: { id: runId } });
		for (let i = 0; i < 20 && service.status().healthy; i++) await Bun.sleep(20);
		expect(service.status().healthy).toBe(false);
		expect(service.status().running).toBe(false);
		expect(errors).toBe(1);
		await expect(service.start()).rejects.toThrow('unavailable');
	} finally {
		off();
		await service.stop().catch(() => {});
	}
});
