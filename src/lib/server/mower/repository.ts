import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { MowerMessage } from './validation';
import { MAINTENANCE_LOCK, recordDaily } from './fleet';

import { IngestionConflict } from './errors';
export { IngestionConflict } from './errors';

/** A transaction keeps each telemetry row and its zone aggregates consistent. */
export async function persistMessage(
	db: PrismaClient,
	runId: string,
	message: MowerMessage,
	delivery?: { message_id: string }
): Promise<boolean> {
	return db.$transaction(async (tx) => {
		await tx.$queryRaw`SELECT pg_advisory_xact_lock_shared(${MAINTENANCE_LOCK}::bigint)::text`;
		const run = await tx.simulationRun.findUniqueOrThrow({
			where: { id: runId },
			include: { machine: true, cycle: true }
		});
		await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${run.machine_id}))::text`;
		const observed = 'timestamp' in message.data ? message.data.timestamp : null;
		await tx.$executeRaw`UPDATE machine SET last_received_at=NOW(), last_observed_at=GREATEST(last_observed_at,${observed}::timestamp) WHERE id=${run.machine_id}::uuid`;

		if (delivery) {
			const payloadHash = createHash('sha256')
				.update(JSON.stringify({ run_id: runId, message }))
				.digest('hex');
			const where = {
				machine_id_message_id: { machine_id: run.machine_id, message_id: delivery.message_id }
			};
			const receipt = await tx.deliveryReceipt.findUnique({ where });
			if (receipt) {
				if (receipt.run_id !== runId || receipt.payload_hash !== payloadHash)
					throw new IngestionConflict(
						'Message ID already acknowledged with different run or payload'
					);
				return false;
			}
			const captured =
				'timestamp' in message.data
					? message.data.timestamp
					: 'start_time' in message.data
						? message.data.start_time
						: null;
			// Receipt and telemetry commit together; failed validation rolls both back.
			await tx.deliveryReceipt.create({
				data: {
					machine_id: run.machine_id,
					message_id: delivery.message_id,
					run_id: runId,
					payload_hash: payloadHash,
					captured_at: captured
				}
			});
		}

		if (message.type === 'zones') {
			for (const zone of message.data) {
				await tx.propertyZone.upsert({
					where: {
						property_id_zone_id: { property_id: run.machine.property_id, zone_id: zone.zone_id }
					},
					create: {
						property_id: run.machine.property_id,
						zone_id: zone.zone_id,
						area_m2: zone.area_m2
					},
					update: {}
				});
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
			await recordDaily(tx, run.machine_id, row);
			if (
				run.cycle_id &&
				row.mode === 'mowing' &&
				!run.cycle?.historical &&
				row.timestamp >= run.cycle!.started_at &&
				(!run.cycle?.completed_at || row.timestamp <= run.cycle.completed_at)
			) {
				const propertyZone = await tx.propertyZone.findUniqueOrThrow({
					where: {
						property_id_zone_id: { property_id: run.machine.property_id, zone_id: row.zone_id }
					}
				});
				const key = {
					cycle_id_machine_id_zone_ref: {
						cycle_id: run.cycle_id,
						machine_id: run.machine_id,
						zone_ref: propertyZone.id
					}
				};
				const previous = await tx.zoneProgress.findUnique({ where: key });
				const estimate = Math.min(
					100,
					(previous?.coverage_pct ?? 0) + (100 * row.speed_mps * 10 * 0.25) / propertyZone.area_m2
				);
				await tx.zoneProgress.upsert({
					where: key,
					create: {
						cycle_id: run.cycle_id,
						machine_id: run.machine_id,
						zone_ref: propertyZone.id,
						coverage_pct: estimate,
						observed_at: row.timestamp
					},
					update: {
						coverage_pct: estimate,
						observed_at:
							previous?.observed_at && previous.observed_at > row.timestamp
								? previous.observed_at
								: row.timestamp
					}
				});
			}
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
