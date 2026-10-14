import { json } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { api } from '#lib/server/mower/http.ts';
import { parseQuery } from '#lib/server/mower/validation.ts';
export const GET = api(async ({ url }) => {
	const q = parseQuery(url.searchParams, [
		'limit',
		'offset',
		'run_id',
		'session_id',
		'zone_id',
		'event_type',
		'from',
		'to'
	]);
	const data = await db.mowerEvent.findMany({
		where: {
			session_ref: q.session_id,
			zone_id: q.zone_id,
			event_type: q.event_type,
			session: q.run_id ? { run_id: q.run_id } : undefined,
			timestamp: { gte: q.from, lte: q.to }
		},
		orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
		take: q.limit + 1,
		skip: q.offset
	});
	return json({
		data: data.slice(0, q.limit),
		pagination: { limit: q.limit, offset: q.offset, has_more: data.length > q.limit }
	});
});
