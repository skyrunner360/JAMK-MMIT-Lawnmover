import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { db } from '#lib/server/db/index.ts';
import { api } from '#lib/server/mower/http.ts';
export const GET = api(async ({ params }) => {
	const id = z.uuid().parse(params.id);
	const data = await db.mowingSession.findUnique({
		where: { id },
		include: { _count: { select: { readings: true, events: true } } }
	});
	if (!data) error(404, 'Mowing session not found');
	return json({ data });
});
