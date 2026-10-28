import { json, error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { api } from '#lib/server/mower/http.ts';
import { parseTrendRange } from '#lib/server/mower/fleet-validation.ts';
import { trendDays } from '#lib/dashboard/fleet.ts';
export const GET = api(async ({ url }) => {
	const q = parseTrendRange(url.searchParams);
	if (!q.machine_id) error(400, 'machine_id is required');
	// Deliberately no raw telemetry query on the seasonal path.
	const rows = await db.dailySummary.findMany({
		where: {
			machine_id: q.machine_id,
			day: { gte: new Date(q.from + 'T00:00:00Z'), lte: new Date(q.to + 'T00:00:00Z') }
		},
		orderBy: { day: 'asc' },
		take: 366
	});
	return json({
		data: trendDays(rows, q.from, q.to),
		source: 'daily_summary',
		from: q.from,
		to: q.to
	});
});
