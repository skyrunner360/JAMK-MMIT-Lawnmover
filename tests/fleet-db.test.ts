import { test, expect, afterAll } from 'bun:test';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { createRun, newCredential } from '../src/lib/server/mower/fleet';
import { persistMessage } from '../src/lib/server/mower/repository';
import { loadDataset } from '../src/lib/server/mower-simulator.js';
import { parseMessage } from '../src/lib/server/mower/validation';
const enabled = process.env.RUN_DB_TESTS === '1',
	db = new PrismaClient();
const propertyId = randomUUID();
afterAll(async () => {
	if (enabled) {
		const machines = await db.machine.findMany({
				where: { property_id: propertyId },
				select: { id: true }
			}),
			ids = machines.map((m) => m.id);
		await db.zoneProgress.deleteMany({ where: { machine_id: { in: ids } } });
		await db.dailySummary.deleteMany({ where: { machine_id: { in: ids } } });
		await db.simulationRun.deleteMany({ where: { machine_id: { in: ids } } });
		await db.machine.deleteMany({ where: { property_id: propertyId } });
		await db.propertyZone.deleteMany({ where: { property_id: propertyId } });
		await db.mowingCycle.deleteMany({ where: { property_id: propertyId } });
		await db.property.deleteMany({ where: { id: propertyId } });
		await db.$disconnect();
	}
});
test.skipIf(!enabled)(
	'concurrent duplicates, late readings and machine isolation preserve exact daily summaries',
	async () => {
		await db.property.create({ data: { id: propertyId, name: 'Fleet integration' } });
		const a = await db.machine.create({
				data: { property_id: propertyId, name: 'A', token_hash: newCredential().token_hash }
			}),
			b = await db.machine.create({ data: { property_id: propertyId, name: 'B' } });
		await db.mowingCycle.create({
			data: { property_id: propertyId, started_at: new Date('2026-01-01T00:00:00Z') }
		});
		const run = await createRun(db, randomUUID(), a.id, 'test');
		await expect(createRun(db, run.id, b.id, 'test')).rejects.toThrow('another machine');
		const ds = loadDataset();
		await persistMessage(db, run.id, parseMessage({ type: 'zones', data: ds.zones.rows }));
		await persistMessage(
			db,
			run.id,
			parseMessage({
				type: 'session_start',
				data: {
					session_id: 1,
					start_time: '2026-01-01T00:00:00Z',
					weather: 'sunny',
					bearing_wear: 0.1
				}
			})
		);
		const reading = (timestamp: string, motor: number) =>
			parseMessage({
				type: 'reading',
				data: { ...ds.main.rows[0], timestamp, motor_current_a: motor, is_anomaly: motor > 5 }
			});
		const row = reading('2026-10-28T10:00:00Z', 2);
		const results = await Promise.all(
			Array.from({ length: 5 }, () => persistMessage(db, run.id, row))
		);
		expect(results.filter(Boolean)).toHaveLength(1);
		await persistMessage(db, run.id, reading('2026-10-27T23:59:50Z', 6));
		const summaries = await db.dailySummary.findMany({
			where: { machine_id: a.id },
			orderBy: { day: 'asc' }
		});
		expect(summaries).toHaveLength(2);
		expect(summaries.map((s) => s.sample_count)).toEqual([1, 1]);
		expect(summaries[0].motor_current_sum).toBe(6);
		expect(summaries[0].anomaly_count).toBe(1);
		const updated = await db.machine.findUniqueOrThrow({ where: { id: a.id } });
		expect(updated.last_observed_at?.toISOString()).toBe('2026-10-28T10:00:00.000Z');
		expect(updated.last_received_at).not.toBeNull();
		expect(await db.dailySummary.count({ where: { machine_id: b.id } })).toBe(0);
		expect(await db.reading.count({ where: { session: { run_id: run.id } } })).toBe(2);
		const original = await db.zoneProgress.findFirstOrThrow({ where: { machine_id: a.id } });
		await persistMessage(db, run.id, row);
		expect(
			(await db.zoneProgress.findUniqueOrThrow({ where: { id: original.id } })).coverage_pct
		).toBe(original.coverage_pct);
		// A new explicit cycle keeps prior progress while a fresh run begins unknown.
		await db.mowingCycle.update({
			where: { id: run.cycle_id! },
			data: { completed_at: new Date() }
		});
		const cycle = await db.mowingCycle.create({ data: { property_id: propertyId } });
		const second = await createRun(db, randomUUID(), a.id, 'test');
		expect(second.cycle_id).toBe(cycle.id);
		expect(await db.zoneProgress.count({ where: { cycle_id: cycle.id } })).toBe(0);
	}
);

test.skipIf(!enabled)('new run without explicit cycle stays unassigned', async () => {
	const machine = await db.machine.findFirstOrThrow({ where: { property_id: propertyId } });
	await db.mowingCycle.updateMany({
		where: { property_id: propertyId, completed_at: null },
		data: { completed_at: new Date() }
	});
	const before = await db.mowingCycle.count({ where: { property_id: propertyId } });
	const run = await createRun(db, randomUUID(), machine.id, 'test');
	expect(run.cycle_id).toBeNull();
	expect(await db.mowingCycle.count({ where: { property_id: propertyId } })).toBe(before);
});

test.skipIf(!enabled)(
	'stable device message ID deduplicates across restarts and preserves capture versus arrival',
	async () => {
		const machine = await db.machine.create({
			data: { property_id: propertyId, name: 'Reconnect fixture' }
		});
		const run = await createRun(db, randomUUID(), machine.id, 'test');
		const ds = loadDataset();
		await persistMessage(db, run.id, parseMessage({ type: 'zones', data: ds.zones.rows }));
		await persistMessage(
			db,
			run.id,
			parseMessage({
				type: 'session_start',
				data: {
					session_id: 1,
					start_time: '2026-01-01T00:00:00Z',
					weather: 'sunny',
					bearing_wear: 0
				}
			})
		);
		const messageId = randomUUID();
		const reading = parseMessage({
			type: 'reading',
			data: { ...ds.main.rows[0], timestamp: '2026-01-01T10:00:00Z' }
		});
		expect(await persistMessage(db, run.id, reading, { message_id: messageId })).toBe(true);
		// A fresh Prisma connection represents a receiver process restart.
		const restarted = new PrismaClient();
		try {
			expect(await persistMessage(restarted, run.id, reading, { message_id: messageId })).toBe(
				false
			);
		} finally {
			await restarted.$disconnect();
		}
		const altered = parseMessage({
			type: 'reading',
			data: { ...ds.main.rows[0], timestamp: '2026-01-01T10:00:10Z' }
		});
		await expect(persistMessage(db, run.id, altered, { message_id: messageId })).rejects.toThrow(
			'different'
		);
		const stored = await db.reading.findFirstOrThrow({ where: { session: { run_id: run.id } } });
		expect(stored.timestamp.toISOString()).toBe('2026-01-01T10:00:00.000Z');
		expect(stored.received_at!.getTime()).toBeGreaterThan(stored.timestamp.getTime());
		const receipt = await db.deliveryReceipt.findUniqueOrThrow({
			where: { machine_id_message_id: { machine_id: machine.id, message_id: messageId } }
		});
		expect(receipt.captured_at?.toISOString()).toBe(stored.timestamp.toISOString());
		expect(await db.reading.count({ where: { session: { run_id: run.id } } })).toBe(1);
	}
);
