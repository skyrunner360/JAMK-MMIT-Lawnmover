import { json } from '@sveltejs/kit';
import { api, readJson } from '#lib/server/mower/http.ts';
import { controlSchema } from '#lib/server/mower/validation.ts';
import { getMowerService } from '#lib/server/mower/service.ts';
export const GET = api(async () => {
	return json({ data: getMowerService().status() });
});
export const POST = api(async ({ request }) => {
	const { action } = controlSchema.parse(await readJson(request));
	const service = getMowerService();
	if (action === 'start') await service.start();
	else await service.stop();
	return json({ data: service.status() });
});
