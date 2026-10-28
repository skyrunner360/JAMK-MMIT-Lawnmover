// Non-destructive: creates and removes only its own synthetic fixture property.
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
const db = new PrismaClient(),
	property = randomUUID(),
	machine = randomUUID(),
	run = randomUUID(),
	session = randomUUID(),
	zone = randomUUID();
try {
	await db.property.create({ data: { id: property, name: 'Benchmark fixture' } });
	await db.machine.create({ data: { id: machine, property_id: property, name: 'Benchmark' } });
	await db.simulationRun.create({ data: { id: run, machine_id: machine, source: 'benchmark' } });
	await db.zone.create({
		data: {
			id: zone,
			run_id: run,
			zone_id: 1,
			area_m2: 150,
			grass_density: 0.5,
			avg_slope_deg: 0,
			avg_motor_current_a: 2,
			avg_speed_mps: 0.4,
			time_spent_s: 0,
			anomaly_count: 0,
			obstacle_events: 0,
			coverage_pct: 0
		}
	});
	await db.mowingSession.create({
		data: {
			id: session,
			run_id: run,
			session_id: 1,
			start_time: new Date('2026-04-01T00:00:00Z'),
			weather: 'synthetic',
			bearing_wear: 0
		}
	});
	await db.$executeRaw`INSERT INTO reading(id,session_ref,zone_ref,timestamp,session_id,zone_id,latitude,longitude,speed_mps,heading_deg,mode,battery_pct,voltage_v,current_a,battery_temp_c,motor_current_a,motor_rpm,slope_deg,grass_load,ambient_temp_c,humidity_pct,rain,is_anomaly)
 SELECT gen_random_uuid(),${session}::uuid,${zone}::uuid,'2026-04-01'::timestamp+n*interval '10 seconds',1,1,0,0,0.4,0,'mowing'::"MowerMode",80,24,2,30,2,3000,0,0.5,20,50,false,false FROM generate_series(0,1555199) n`;
	await db.$executeRaw`INSERT INTO daily_summary(machine_id,day,sample_count,anomaly_count,motor_current_sum,motor_current_max,temperature_max,battery_sum,battery_min)
 SELECT ${machine}::uuid,'2026-04-01'::date+n,8640,0,17280,2,30,691200,80 FROM generate_series(0,179)n`;
	await db.$executeRaw`ANALYZE reading`;
	await db.$executeRaw`ANALYZE daily_summary`;
	const detail =
		await db.$queryRaw`EXPLAIN (ANALYZE,BUFFERS,FORMAT TEXT) SELECT * FROM reading WHERE session_ref=${session}::uuid ORDER BY timestamp DESC,id DESC LIMIT 200`;
	const season =
		await db.$queryRaw`EXPLAIN (ANALYZE,BUFFERS,FORMAT TEXT) SELECT * FROM daily_summary WHERE machine_id=${machine}::uuid AND day>='2026-04-01'::date AND day<='2026-09-27'::date ORDER BY day`;
	console.log(JSON.stringify({ raw_rows: 1555200, summary_rows: 180, detail, season }, null, 2));
} finally {
	await db.dailySummary.deleteMany({ where: { machine_id: machine } });
	await db.simulationRun.deleteMany({ where: { id: run } });
	await db.machine.deleteMany({ where: { id: machine } });
	await db.property.deleteMany({ where: { id: property } });
	await db.$disconnect();
}
