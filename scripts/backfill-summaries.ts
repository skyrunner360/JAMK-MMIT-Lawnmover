import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { parseTrendRange } from '../src/lib/server/mower/fleet-validation';
import { MAINTENANCE_LOCK } from '../src/lib/server/mower/fleet';
const machineId = z.uuid().parse(process.argv[2]);
const q = parseTrendRange(new URLSearchParams({ from: process.argv[3], to: process.argv[4] }));
const db = new PrismaClient();
try {
	await db.machine.findUniqueOrThrow({ where: { id: machineId } });
	for (let time = Date.parse(q.from); time <= Date.parse(q.to); time += 86400000) {
		const day = new Date(time),
			end = new Date(time + 86400000);
		await db.$transaction(
			async (tx) => {
				// Exclusive maintenance lock; live ingestion takes its shared counterpart.
				await tx.$queryRaw`SELECT pg_advisory_xact_lock(${MAINTENANCE_LOCK}::bigint)::text`;
				await tx.dailySummary.deleteMany({ where: { machine_id: machineId, day } });
				await tx.$executeRaw`
    INSERT INTO daily_summary(machine_id,day,sample_count,anomaly_count,motor_current_sum,motor_current_max,temperature_max,battery_sum,battery_min)
    SELECT ${machineId}::uuid,${day}::date,COUNT(*)::integer,SUM(CASE WHEN r.is_anomaly THEN 1 ELSE 0 END)::integer,
    SUM(r.motor_current_a),MAX(r.motor_current_a),MAX(r.battery_temp_c),SUM(r.battery_pct),MIN(r.battery_pct)
    FROM reading r JOIN mowing_session s ON s.id=r.session_ref JOIN simulation_run run ON run.id=s.run_id
    WHERE run.machine_id=${machineId}::uuid AND r.timestamp>=${day} AND r.timestamp<${end}
    HAVING COUNT(*)>0`;
			},
			{ timeout: 60000, maxWait: 60000 }
		);
		console.log(day.toISOString().slice(0, 10));
	}
} finally {
	await db.$disconnect();
}
