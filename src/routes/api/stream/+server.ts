import { api } from '#lib/server/mower/http.ts';
import { getMowerService } from '#lib/server/mower/service.ts';
import { createEventStream } from '#lib/server/mower/stream.ts';
export const GET = api(async ({ request, url }) => {
	const service = getMowerService();
	if (url.searchParams.get('autostart') !== 'false') await service.start();
	return createEventStream(service, request.signal);
});
