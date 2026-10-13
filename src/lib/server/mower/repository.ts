import type { PrismaClient } from '@prisma/client';
import type { MowerMessage } from './validation';

export class IngestionConflict extends Error {}

/** A transaction keeps each telemetry row and its zone aggregates consistent. */
export async function persistMessage(
	db: PrismaClient,
	runId: string,
	message: MowerMessage
): Promise<boolean> {
	return db.$transaction(async (tx) => {
		if (message.type === 'zones') {
			for (const zone of message.data) {
				const where = { run_id_zone_id: { run_id: runId, zone_id: zone.zone_id } };
				const existing = await tx.zone.findUnique({ where });
				// A retried earlier snapshot must not roll back cumulative measurements.
				if (existing && existing.time_spent_s > zone.time_spent_s) continue;
				const update = {
					...zone,
					anomaly_count: Math.max(existing?.anomaly_count ?? 0, zone.anomaly_count),
					obstacle_events: Math.max(existing?.obstacle_events ?? 0, zone.obstacle_events),
					coverage_pct: Math.max(existing?.coverage_pct ?? 0, zone.coverage_pct)
				};
				await tx.zone.upsert({ where, create: { run_id: runId, ...zone }, update });
			}
			return true;
		}
		if (message.type === 'session_start' || message.type === 'session_end') {
			const data = message.data;
			await tx.mowingSession.upsert({
				where: { run_id_session_id: { run_id: runId, session_id: data.session_id } },
				create: { run_id: runId, ...data },
				update: message.type === 'session_end' ? data : {}
			});
			return true;
		}
		const data = message.data;
		const session = await tx.mowingSession.findUnique({
			where: { run_id_session_id: { run_id: runId, session_id: data.session_id } }
		});
		if (!session) throw new IngestionConflict('Send session_start before telemetry');
		const zone = await tx.zone.findUnique({
			where: { run_id_zone_id: { run_id: runId, zone_id: data.zone_id } }
		});
		if (!zone) throw new IngestionConflict('Send zones before telemetry');
		if (message.type === 'reading') {
			const row = message.data;
			const inserted = await tx.reading.createMany({
				data: [{ ...row, session_ref: session.id, zone_ref: zone.id }],
				skipDuplicates: true
			});
			if (!inserted.count) return false;
			if (row.mode !== 'charging') {
				const n = zone.time_spent_s / 10;
				await tx.zone.update({
					where: { id: zone.id },
					data: {
						avg_motor_current_a: (zone.avg_motor_current_a * n + row.motor_current_a) / (n + 1),
						avg_speed_mps: (zone.avg_speed_mps * n + row.speed_mps) / (n + 1),
						time_spent_s: { increment: 10 },
						anomaly_count: { increment: row.is_anomaly ? 1 : 0 },
						coverage_pct: Math.min(100, (100 * (n + 1)) / (5 * zone.area_m2))
					}
				});
			}
		} else {
			const inserted = await tx.mowerEvent.createMany({
				data: [{ ...message.data, session_ref: session.id, zone_ref: zone.id }],
				skipDuplicates: true
			});
			if (!inserted.count) return false;
			if (message.data.event_type === 'obstacle_detected' || message.data.event_type === 'bump') {
				await tx.zone.update({
					where: { id: zone.id },
					data: { obstacle_events: { increment: 1 } }
				});
			}
		}
		return true;
	});
}
