import { createHash, randomBytes } from 'node:crypto';
import type { PrismaClient, Prisma } from '@prisma/client';
import { IngestionConflict } from './errors';
import { dailyValues } from '../../dashboard/fleet';
export const DEMO_PROPERTY = '00000000-0000-4000-8000-000000000001';
export const DEMO_MACHINE = '00000000-0000-4000-8000-000000000002';
export const MAINTENANCE_LOCK = 4590010;
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export function newCredential() {
	const token = randomBytes(32).toString('base64url');
	return { token, token_hash: hashToken(token) };
}
export async function ensureDemoFleet(db: PrismaClient) {
	await db.property.upsert({
		where: { id: DEMO_PROPERTY },
		create: { id: DEMO_PROPERTY, name: 'JAMK garden' },
		update: {}
	});
	await db.machine.upsert({
		where: { id: DEMO_MACHINE },
		create: { id: DEMO_MACHINE, property_id: DEMO_PROPERTY, name: 'Demo mower' },
		update: {}
	});
	// Only the demo property receives synthetic definitions, never real machine measurements.
	await db.propertyZone.createMany({
		data: Array.from({ length: 60 }, (_, i) => ({
			property_id: DEMO_PROPERTY,
			zone_id: i + 1,
			area_m2: 150
		})),
		skipDuplicates: true
	});
}
export async function createRun(db: PrismaClient, id: string, machineId: string, source: string) {
	return db.$transaction(async (tx) => {
		await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${machineId}))::text`;
		const existing = await tx.simulationRun.findUnique({ where: { id } });
		if (existing) {
			if (existing.machine_id !== machineId)
				throw new IngestionConflict('Run belongs to another machine');
			return existing;
		}
		const machine = await tx.machine.findUniqueOrThrow({ where: { id: machineId } });
		// Lock property against concurrent cycle controls.
		await tx.$queryRaw`SELECT id FROM property WHERE id=${machine.property_id}::uuid FOR UPDATE`;
		const cycle = await tx.mowingCycle.findFirst({
			where: { property_id: machine.property_id, completed_at: null }
		});
		return tx.simulationRun.create({
			data: { id, machine_id: machineId, cycle_id: cycle?.id ?? null, source }
		});
	});
}
export async function recordDaily(
	tx: Prisma.TransactionClient,
	machineId: string,
	row: Parameters<typeof dailyValues>[0]
) {
	const v = dailyValues(row);
	await tx.$executeRaw`
 INSERT INTO daily_summary(machine_id,day,sample_count,anomaly_count,motor_current_sum,motor_current_max,temperature_max,battery_sum,battery_min)
 VALUES (${machineId}::uuid,${v.day},1,${v.anomaly_count},${v.motor_current_sum},${v.motor_current_max},${v.temperature_max},${v.battery_sum},${v.battery_min})
 ON CONFLICT(machine_id,day) DO UPDATE SET
 sample_count=daily_summary.sample_count+1, anomaly_count=daily_summary.anomaly_count+EXCLUDED.anomaly_count,
 motor_current_sum=daily_summary.motor_current_sum+EXCLUDED.motor_current_sum,
 motor_current_max=GREATEST(daily_summary.motor_current_max,EXCLUDED.motor_current_max),
 temperature_max=GREATEST(daily_summary.temperature_max,EXCLUDED.temperature_max),
 battery_sum=daily_summary.battery_sum+EXCLUDED.battery_sum, battery_min=LEAST(daily_summary.battery_min,EXCLUDED.battery_min)`;
}
