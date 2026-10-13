import { api, requireUser } from '#lib/server/mower/http.ts';
import { getMowerService } from '#lib/server/mower/service.ts';
import { createEventStream } from '#lib/server/mower/stream.ts';
export const GET = api(async ({ locals, request }) => {
	requireUser(locals);
	const service = getMowerService();
	await service.start();
	return createEventStream(service, request.signal);
});
