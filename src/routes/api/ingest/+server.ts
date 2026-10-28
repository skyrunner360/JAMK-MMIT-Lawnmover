import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { db } from '#lib/server/db/index.ts';
import { api, requireIngestToken, readJson } from '#lib/server/mower/http.ts';
import { parseMessage } from '#lib/server/mower/validation.ts';
import { ingestExternal } from '#lib/server/mower/service.ts';
import { hashToken, DEMO_MACHINE, ensureDemoFleet } from '#lib/server/mower/fleet.ts';
export const POST = api(async ({ request }) => {
	const machineHeader = request.headers.get('x-machine-id');
	let machineId = DEMO_MACHINE;
	let runId: string;
	if (machineHeader) {
		machineId = z.uuid().parse(machineHeader);
		const token = request.headers.get('authorization')?.match(/^Bearer (\S+)$/)?.[1];
		if (!token) error(401, 'Machine credential required');
		const machine = await db.machine.findUnique({
			where: { id: machineId },
			select: { token_hash: true }
		});
		if (!machine?.token_hash || machine.token_hash !== hashToken(token))
			error(401, 'Invalid machine credential');
		runId = z.uuid().parse(request.headers.get('x-run-id'));
	} else {
		requireIngestToken(request.headers, process.env.MOWER_INGEST_TOKEN);
		const run = z.uuid().safeParse(process.env.MOWER_EXTERNAL_RUN_ID);
		if (!run.success) error(503, 'Configure a valid MOWER_EXTERNAL_RUN_ID');
		runId = run.data;
		await ensureDemoFleet(db);
	}
	const messageId = z
		.uuid()
		.optional()
		.parse(request.headers.get('x-message-id') ?? undefined);
	const message = parseMessage(await readJson(request));
	const inserted = await ingestExternal(
		runId,
		message,
		machineId,
		messageId ? { message_id: messageId } : undefined
	);
	return json({
		accepted: true,
		inserted,
		run_id: runId,
		...(messageId ? { message_id: messageId } : {})
	});
});
