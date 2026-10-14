import type { Handle } from '@sveltejs/kit/hooks';
import { json } from '@sveltejs/kit';
import { building } from '$app/env';
import { auth } from '#lib/server/auth.ts';
import { svelteKitHandler } from 'better-auth/svelte-kit';

export const handle: Handle = async ({ event, resolve }) => {
	// Dashboard demo temporarily bypasses authentication. Retain the auth demo separately.
	if (
		!event.url.pathname.startsWith('/demo/better-auth') &&
		!event.url.pathname.startsWith('/api/auth')
	)
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
