import { json } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { api } from '#lib/server/mower/http.ts';
import { parseQuery } from '#lib/server/mower/validation.ts';
export const GET = api(async ({ url }) => {
	const q = parseQuery(url.searchParams, [
		'limit',
		'offset',
		'run_id',
		'machine_id',
		'session_id',
		'from',
		'to'
	]);
	const data = await db.mowingSession.findMany({
		where: {
			id: q.session_id,
			run_id: q.run_id,
			run: { machine_id: q.machine_id },
			start_time: { gte: q.from, lte: q.to }
		},
		orderBy: [{ start_time: 'desc' }, { id: 'desc' }],
		take: q.limit + 1,
		skip: q.offset
	});
	return json({
		data: data.slice(0, q.limit),
		pagination: { limit: q.limit, offset: q.offset, has_more: data.length > q.limit }
	});
});
