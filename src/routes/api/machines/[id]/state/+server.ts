import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { db } from '#lib/server/db/index.ts';
import { api } from '#lib/server/mower/http.ts';
import { currentState } from '#lib/server/mower/queries.ts';
export const GET = api(async ({ params }) => {
	const id = z.uuid().parse(params.id);
	const machine = await db.machine.findUnique({ where: { id }, select: { id: true } });
	if (!machine) error(404, 'Machine not found');
	const run = await db.simulationRun.findFirst({
		where: { machine_id: id },
		orderBy: [{ created_at: 'desc' }, { id: 'desc' }]
	});
	return json({
		data: run
			? await currentState(run.id)
			: { run_id: null, reading: null, session: null, zones: [] }
	});
});
