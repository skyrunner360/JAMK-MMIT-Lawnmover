import { test, expect } from 'bun:test';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { createRun } from '../src/lib/server/mower/fleet';
import { persistMessage } from '../src/lib/server/mower/repository';
import { loadDataset } from '../src/lib/server/mower-simulator.js';
import { parseMessage } from '../src/lib/server/mower/validation';
test.skipIf(process.env.RUN_DB_TESTS !== '1')(
	'backfill repairs summaries idempotently while concurrent ingestion remains exact',
	async () => {
		const db = new PrismaClient(),
			property = randomUUID(),
			machine = randomUUID();
		try {
			await db.property.create({ data: { id: property, name: 'Backfill fixture' } });
			await db.machine.create({ data: { id: machine, property_id: property, name: 'Backfill' } });
			const run = await createRun(db, randomUUID(), machine, 'test'),
				ds = loadDataset();
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
			const row = (n: number) =>
				parseMessage({
					type: 'reading',
					data: {
						...ds.main.rows[0],
						timestamp: `2026-10-01T10:00:${String(n * 10).padStart(2, '0')}Z`
					}
				});
			await persistMessage(db, run.id, row(0));
			await db.dailySummary.updateMany({
				where: { machine_id: machine },
				data: { sample_count: 123 }
			});
			const backfill = async () => {
				const child = Bun.spawn(
					[process.execPath, 'scripts/backfill-summaries.ts', machine, '2026-10-01', '2026-10-01'],
					{ env: process.env, stdout: 'pipe', stderr: 'pipe' }
				);
				const errors = await new Response(child.stderr).text();
				expect(await child.exited, errors).toBe(0);
			};
			await Promise.all([
				backfill(),
				...Array.from({ length: 4 }, (_, i) => persistMessage(db, run.id, row(i + 1)))
			]);
			expect(
				(await db.dailySummary.findFirstOrThrow({ where: { machine_id: machine } })).sample_count
			).toBe(5);
			await backfill();
			expect(
				(await db.dailySummary.findFirstOrThrow({ where: { machine_id: machine } })).sample_count
			).toBe(5);
		} finally {
			await db.zoneProgress.deleteMany({ where: { machine_id: machine } });
			await db.dailySummary.deleteMany({ where: { machine_id: machine } });
			await db.simulationRun.deleteMany({ where: { machine_id: machine } });
			await db.machine.deleteMany({ where: { id: machine } });
			await db.propertyZone.deleteMany({ where: { property_id: property } });
			await db.mowingCycle.deleteMany({ where: { property_id: property } });
			await db.property.deleteMany({ where: { id: property } });
			await db.$disconnect();
		}
	}
);
