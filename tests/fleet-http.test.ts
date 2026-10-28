import { test, expect, afterAll } from 'bun:test';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { newCredential } from '../src/lib/server/mower/fleet';
import { loadDataset } from '../src/lib/server/mower-simulator.js';
const base = process.env.MOWER_FLEET_TEST_URL,
	enabled = !!base && process.env.RUN_DB_TESTS === '1',
	db = new PrismaClient(),
	propertyId = randomUUID();
afterAll(async () => {
	if (enabled) {
		const machines = await db.machine.findMany({ where: { property_id: propertyId } }),
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
	'HTTP fleet ingestion enforces credentials/run ownership and separates session/trend reads',
	async () => {
		await db.property.create({ data: { id: propertyId, name: 'HTTP fixture' } });
		const cycle = await db.mowingCycle.create({
			data: { property_id: propertyId, started_at: new Date('2026-01-01T00:00:00Z') }
		});
		const auth = newCredential(),
			other = newCredential();
		const a = await db.machine.create({
				data: { property_id: propertyId, name: 'A', token_hash: auth.token_hash }
			}),
			b = await db.machine.create({
				data: { property_id: propertyId, name: 'B', token_hash: other.token_hash }
			}),
			run = randomUUID();
		const deliveryId = randomUUID();
		const post = (machine: string, token: string, message: unknown, messageId?: string) =>
			fetch(base + '/api/ingest', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'x-machine-id': machine,
					'x-run-id': run,
					...(messageId ? { 'x-message-id': messageId } : {}),
					authorization: 'Bearer ' + token
				},
				body: JSON.stringify(message)
			});
		const ds = loadDataset();
		expect((await post(a.id, 'wrong', { type: 'zones', data: ds.zones.rows })).status).toBe(401);
		expect((await post(a.id, auth.token, { type: 'zones', data: ds.zones.rows })).status).toBe(200);
		expect((await post(b.id, other.token, { type: 'zones', data: ds.zones.rows })).status).toBe(
			409
		);
		await post(a.id, auth.token, {
			type: 'session_start',
			data: {
				session_id: 1,
				start_time: '2026-10-01T00:00:00Z',
				weather: 'sunny',
				bearing_wear: 0.1
			}
		});
		const row = {
			type: 'reading',
			data: { ...ds.main.rows[0], timestamp: '2026-10-01T10:00:00Z' }
		};
		expect((await (await post(a.id, auth.token, row, deliveryId)).json()).inserted).toBe(true);
		expect((await (await post(a.id, auth.token, row, deliveryId)).json()).inserted).toBe(false);
		const ack = await (await post(a.id, auth.token, row, deliveryId)).json();
		expect(ack.message_id).toBe(deliveryId);
		const conflict = await post(
			a.id,
			auth.token,
			{ ...row, data: { ...row.data, battery_pct: 1 } },
			deliveryId
		);
		expect(conflict.status).toBe(409);
		const fleet = await (await fetch(`${base}/api/fleet?property_id=${propertyId}`)).json();
		expect(JSON.stringify(fleet)).not.toContain('token_hash');
		expect(fleet.cycle.id).toBe(cycle.id);
		expect(fleet.machines.find((m: any) => m.id === a.id).fresh).toBe(false);
		const sessions = await (await fetch(`${base}/api/sessions?machine_id=${a.id}`)).json();
		expect(sessions.data).toHaveLength(1);
		expect(
			(await fetch(`${base}/api/sessions/${sessions.data[0].id}?machine_id=${b.id}`)).status
		).toBe(404);
		const raw = await (
			await fetch(`${base}/api/readings?machine_id=${b.id}&session_id=${sessions.data[0].id}`)
		).json();
		expect(raw.data).toHaveLength(0);
		const trends = await (
			await fetch(`${base}/api/trends?machine_id=${a.id}&from=2026-10-01&to=2026-10-03`)
		).json();
		expect(trends.source).toBe('daily_summary');
		expect(trends.data[0].sample_count).toBe(1);
		expect(trends.data[1].sample_count).toBeNull();
		expect(
			(await fetch(`${base}/api/trends?machine_id=${a.id}&from=2026-10-03&to=2026-10-01`)).status
		).toBe(400);
	}
);
