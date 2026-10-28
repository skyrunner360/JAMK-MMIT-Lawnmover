import type { Prisma } from '@prisma/client';
import { db } from '../db/index';
import { parseQuery } from './validation';

export function telemetryFilters(q: ReturnType<typeof parseQuery>): Prisma.ReadingWhereInput {
	return {
		...(q.session_id ? { session_ref: q.session_id } : {}),
		...(q.run_id || q.machine_id
			? { session: { run_id: q.run_id, run: { machine_id: q.machine_id } } }
			: {}),
		...(q.zone_id ? { zone_id: q.zone_id } : {}),
		...(q.from || q.to ? { timestamp: { gte: q.from, lte: q.to } } : {})
	};
}
export async function currentState(runId?: string | null) {
	const run = runId
		? await db.simulationRun.findUnique({ where: { id: runId } })
		: await db.simulationRun.findFirst({ orderBy: [{ created_at: 'desc' }, { id: 'desc' }] });
	if (!run) return { run_id: null, reading: null, session: null, zones: [] };
	const [reading, session, zones] = await Promise.all([
		db.reading.findFirst({
			where: { session: { run_id: run.id } },
			orderBy: [{ timestamp: 'desc' }, { id: 'desc' }]
		}),
		db.mowingSession.findFirst({
			where: { run_id: run.id },
			orderBy: [{ start_time: 'desc' }, { id: 'desc' }]
		}),
		db.zone.findMany({ where: { run_id: run.id }, orderBy: { zone_id: 'asc' } })
	]);
	return { run_id: run.id, reading, session, zones };
}
