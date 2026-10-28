import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { db } from '#lib/server/db/index.ts';
import { api } from '#lib/server/mower/http.ts';
export const GET = api(async ({ params, url }) => {
	const id = z.uuid().parse(params.id);
	const data = await db.mowingSession.findUnique({
		where: {
			id,
			run: {
				machine_id: z
					.uuid()
					.optional()
					.parse(url.searchParams.get('machine_id') ?? undefined)
			}
		},
		include: { _count: { select: { readings: true, events: true } } }
	});
	if (!data) error(404, 'Mowing session not found');
	return json({ data });
});
