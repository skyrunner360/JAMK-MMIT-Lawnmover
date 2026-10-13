import { z } from 'zod';

// The simulator uses offset-free CSV timestamps. Interpret those as UTC, never local time.
export const utcTimestamp = z.string().transform((value, ctx) => {
	const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
		? value.replace(' ', 'T') + 'Z'
		: value;
	if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(normalized)) {
		ctx.addIssue({ code: 'custom', message: 'Use a UTC ISO timestamp or YYYY-MM-DD HH:mm:ss' });
		return z.NEVER;
	}
	const date = new Date(normalized);
	if (
		!Number.isFinite(date.getTime()) ||
		date.toISOString().slice(0, 19) !== normalized.slice(0, 19)
	) {
		ctx.addIssue({ code: 'custom', message: 'Invalid calendar date' });
		return z.NEVER;
	}
	return date;
});
const finite = z.number().finite();
const positiveId = z.number().int().positive().max(2147483647);
const nonnegative = finite.min(0);
const count = z.number().int().min(0).max(2147483647);
const pct = finite.min(0).max(100);
const unit = finite.min(0).max(1);
const position = { latitude: finite.min(-90).max(90), longitude: finite.min(-180).max(180) };
export const modes = z.enum(['mowing', 'returning', 'charging']);
export const eventTypes = z.enum([
	'obstacle_detected',
	'bump',
	'high_load',
	'stall',
	'unexpected_stop',
	'lift',
	'tilt'
]);
export const zoneSchema = z
	.object({
		zone_id: positiveId,
		area_m2: finite.positive(),
		grass_density: unit,
		avg_slope_deg: finite.min(0).max(90),
		avg_motor_current_a: nonnegative,
		avg_speed_mps: nonnegative,
		time_spent_s: count,
		anomaly_count: count,
		obstacle_events: count,
		coverage_pct: pct
	})
	.strict();
export const readingSchema = z
	.object({
		timestamp: utcTimestamp,
		session_id: positiveId,
		...position,
		speed_mps: nonnegative,
		heading_deg: finite.min(0).max(360),
		mode: modes,
		battery_pct: pct,
		voltage_v: nonnegative,
		current_a: finite,
		battery_temp_c: finite,
		motor_current_a: nonnegative,
		motor_rpm: count,
		slope_deg: finite.min(-90).max(90),
		grass_load: unit,
		ambient_temp_c: finite,
		humidity_pct: pct,
		rain: z.boolean(),
		zone_id: positiveId,
		is_anomaly: z.boolean()
	})
	.strict();
const startFields = {
	session_id: positiveId,
	start_time: utcTimestamp,
	weather: z.string().min(1).max(40),
	bearing_wear: unit
};
export const sessionStartSchema = z.object(startFields).strict();
export const sessionEndSchema = z
	.object({
		...startFields,
		end_time: utcTimestamp,
		duration_min: count,
		battery_start_pct: pct,
		battery_end_pct: pct,
		rows: count,
		area_covered_m2: nonnegative,
		mean_motor_current_a: nonnegative,
		peak_motor_current_a: nonnegative,
		anomaly_rows: count,
		sessions_to_failure: count.nullable(),
		ended_with_error: z.string().min(1).max(80).nullable()
	})
	.strict()
	.refine((d) => d.end_time >= d.start_time, { message: 'Session ends before it starts' });
export const eventSchema = z
	.object({
		timestamp: utcTimestamp,
		session_id: positiveId,
		...position,
		event_type: eventTypes,
		error_code: z.string().min(1).max(80).nullable(),
		zone_id: positiveId
	})
	.strict();
export const messageSchema = z.discriminatedUnion('type', [
	z.object({ type: z.literal('reading'), data: readingSchema }).strict(),
	z.object({ type: z.literal('event'), data: eventSchema }).strict(),
	z.object({ type: z.literal('session_start'), data: sessionStartSchema }).strict(),
	z.object({ type: z.literal('session_end'), data: sessionEndSchema }).strict(),
	z
		.object({
			type: z.literal('zones'),
			data: z
				.array(zoneSchema)
				.min(1)
				.max(1000)
				.refine(
					(zones) => new Set(zones.map((z) => z.zone_id)).size === zones.length,
					'Duplicate zone IDs'
				)
		})
		.strict()
]);
export type MowerMessage = z.infer<typeof messageSchema>;
export type ZoneData = z.infer<typeof zoneSchema>;
export function parseMessage(value: unknown): MowerMessage {
	return messageSchema.parse(value);
}
const queryInt = (min: number, max: number) =>
	z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(min).max(max));
export const querySchema = z
	.object({
		limit: queryInt(1, 200).default(50),
		offset: queryInt(0, 1000000).default(0),
		run_id: z.uuid().optional(),
		session_id: z.uuid().optional(),
		zone_id: queryInt(1, 2147483647).optional(),
		mode: modes.optional(),
		event_type: eventTypes.optional(),
		is_anomaly: z
			.enum(['true', 'false'])
			.transform((v) => v === 'true')
			.optional(),
		from: utcTimestamp.optional(),
		to: utcTimestamp.optional()
	})
	.strict()
	.refine((q) => !q.from || !q.to || q.from <= q.to, { message: 'from must not be after to' });
export function parseQuery(params: URLSearchParams, allowed?: readonly string[]) {
	if (allowed && [...params.keys()].some((key) => !allowed.includes(key)))
		throw new z.ZodError([{ code: 'custom', path: [], message: 'Unsupported query parameter' }]);
	if (new Set(params.keys()).size !== [...params.keys()].length)
		throw new z.ZodError([{ code: 'custom', path: [], message: 'Duplicate query parameters' }]);
	return querySchema.parse(Object.fromEntries(params));
}
export const controlSchema = z.object({ action: z.enum(['start', 'stop']) }).strict();
