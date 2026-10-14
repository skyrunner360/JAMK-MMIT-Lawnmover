import { json } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { api } from '#lib/server/mower/http.ts';
import { parseQuery } from '#lib/server/mower/validation.ts';
import { getMowerService } from '#lib/server/mower/service.ts';
export const GET = api(async ({ url }) => {
	const q = parseQuery(url.searchParams, ['limit', 'offset', 'run_id', 'zone_id']);
	const runId =
		q.run_id ??
		getMowerService().status().run_id ??
		(await db.simulationRun.findFirst({ orderBy: [{ created_at: 'desc' }, { id: 'desc' }] }))?.id;
	const data = runId
		? await db.zone.findMany({
				where: { run_id: runId, zone_id: q.zone_id },
				orderBy: { zone_id: 'asc' },
				take: q.limit + 1,
				skip: q.offset
			})
		: [];
	return json({
		run_id: runId ?? null,
		data: data.slice(0, q.limit),
		pagination: { limit: q.limit, offset: q.offset, has_more: data.length > q.limit }
	});
});
