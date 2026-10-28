import { z } from 'zod';
export const dayString = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/)
	.refine((v) => {
		const t = Date.parse(v + 'T00:00:00Z');
		return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === v;
	}, 'Invalid date');
export function parseTrendRange(params: URLSearchParams) {
	if ([...params.keys()].length !== new Set(params.keys()).size)
		throw new z.ZodError([{ code: 'custom', path: [], message: 'Duplicate parameter' }]);
	return z
		.object({ machine_id: z.uuid().optional(), from: dayString, to: dayString })
		.strict()
		.refine(
			(q) => q.from <= q.to && Date.parse(q.to) - Date.parse(q.from) <= 365 * 86400000,
			'Choose at most 366 days in chronological order'
		)
		.parse(Object.fromEntries(params));
}
export const cycleAction = z
	.object({ property_id: z.uuid(), action: z.enum(['start', 'complete']) })
	.strict();
