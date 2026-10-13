import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { api, requireIngestToken, readJson } from '#lib/server/mower/http.ts';
import { parseMessage } from '#lib/server/mower/validation.ts';
import { ingestExternal } from '#lib/server/mower/service.ts';
export const POST = api(async ({ request }) => {
	requireIngestToken(request.headers, process.env.MOWER_INGEST_TOKEN);
	const run = z.uuid().safeParse(process.env.MOWER_EXTERNAL_RUN_ID);
	if (!run.success) error(503, 'Configure a valid MOWER_EXTERNAL_RUN_ID');
	const message = parseMessage(await readJson(request));
	const inserted = await ingestExternal(run.data, message);
	return json({ accepted: true, inserted, run_id: run.data });
});
