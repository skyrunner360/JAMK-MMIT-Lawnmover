import { json } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { api, requireUser } from '#lib/server/mower/http.ts';
import { telemetryFilters } from '#lib/server/mower/queries.ts';
import { parseQuery } from '#lib/server/mower/validation.ts';
export const GET = api(async ({ locals, url }) => {
	requireUser(locals);
	const q = parseQuery(url.searchParams, [
		'limit',
		'offset',
		'run_id',
		'session_id',
		'zone_id',
		'mode',
		'is_anomaly',
		'from',
		'to'
	]);
	const data = await db.reading.findMany({
		where: { ...telemetryFilters(q), mode: q.mode, is_anomaly: q.is_anomaly },
		orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
		take: q.limit + 1,
		skip: q.offset
	});
	return json({
		data: data.slice(0, q.limit),
		pagination: { limit: q.limit, offset: q.offset, has_more: data.length > q.limit }
	});
});
