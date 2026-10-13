import { timingSafeEqual } from 'node:crypto';
import { error, isHttpError, json, type RequestHandler } from '@sveltejs/kit';
import { ZodError } from 'zod';
import { IngestionConflict } from './repository';

export function requireUser(locals: { user?: unknown }) {
	if (!locals.user) error(401, 'Sign in to access mower data');
}
export function requireIngestToken(headers: Headers, token: string | undefined) {
	if (!token) error(503, 'External ingestion is not configured');
	const actual = Buffer.from(headers.get('authorization') ?? '');
	const expected = Buffer.from(`Bearer ${token}`);
	if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
		error(401, 'Invalid ingestion token');
}
export async function readJson(request: Request): Promise<unknown> {
	if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json')
		error(415, 'Use application/json');
	const limit = 256 * 1024;
	if (Number(request.headers.get('content-length')) > limit)
		error(413, 'Request body is too large');
	if (!request.body) error(400, 'JSON body required');
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			const part = await reader.read();
			if (part.done) break;
			size += part.value.length;
			if (size > limit) {
				await reader.cancel();
				error(413, 'Request body is too large');
			}
			chunks.push(part.value);
		}
	} finally {
		reader.releaseLock();
	}
	try {
		return JSON.parse(Buffer.concat(chunks).toString('utf8'));
	} catch {
		error(400, 'Invalid JSON');
	}
}
export function api(handler: RequestHandler): RequestHandler {
	return async (event) => {
		try {
			const origin = event.request.headers.get('origin');
			if (
				event.locals.user &&
				!['GET', 'HEAD', 'OPTIONS'].includes(event.request.method) &&
				origin &&
				origin !== event.url.origin
			)
				error(403, 'Cross-origin mutation rejected');
			return await handler(event);
		} catch (cause) {
			if (isHttpError(cause)) return json({ error: cause.body.message }, { status: cause.status });
			if (cause instanceof ZodError)
				return json(
					{
						error: 'Invalid request',
						issues: cause.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
					},
					{ status: 400 }
				);
			if (cause instanceof IngestionConflict)
				return json({ error: cause.message }, { status: 409 });
			console.error('Mower API failed:', cause);
			return json({ error: 'Mower service unavailable' }, { status: 503 });
		}
	};
}
