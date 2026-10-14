import { json } from '@sveltejs/kit';
import { api } from '#lib/server/mower/http.ts';
import { currentState } from '#lib/server/mower/queries.ts';
import { getMowerService } from '#lib/server/mower/service.ts';
export const GET = api(async () => {
	const simulator = getMowerService().status();
	return json({ data: await currentState(simulator.run_id), simulator });
});
