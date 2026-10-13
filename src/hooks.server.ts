import type { Handle } from '@sveltejs/kit/hooks';
import { json } from '@sveltejs/kit';
import { building } from '$app/env';
import { auth } from '#lib/server/auth.ts';
import { svelteKitHandler } from 'better-auth/svelte-kit';

export const handle: Handle = async ({ event, resolve }) => {
	// Health and device ingestion use their own checks and do not need cookie lookup.
	if (event.url.pathname === '/api/health' || event.url.pathname === '/api/ingest')
		return resolve(event);
	try {
		const session = await auth.api.getSession({ headers: event.request.headers });
		if (session) {
			event.locals.session = session.session;
			event.locals.user = session.user;
		}
	} catch (cause) {
		if (event.url.pathname.startsWith('/api/')) {
			console.error('Session lookup failed:', cause);
			return json({ error: 'Authentication service unavailable' }, { status: 503 });
		}
		throw cause;
	}
	return svelteKitHandler({ event, resolve, auth, building });
};
