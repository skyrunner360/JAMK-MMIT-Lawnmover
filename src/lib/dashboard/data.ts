export interface Reading {
	timestamp: string;
	session_id: number;
	zone_id: number;
	latitude: number;
	longitude: number;
	battery_pct: number;
	motor_current_a: number;
	motor_rpm: number;
	speed_mps: number;
	battery_temp_c: number;
	ambient_temp_c: number;
	humidity_pct: number;
	rain: boolean;
	mode: 'mowing' | 'returning' | 'charging';
	is_anomaly: boolean;
	voltage_v: number;
}
export interface Zone {
	zone_id: number;
	area_m2: number;
	coverage_pct: number;
	anomaly_count: number;
	obstacle_events: number;
	time_spent_s: number;
	avg_motor_current_a: number;
}
export interface MowerEvent {
	timestamp: string;
	session_id: number;
	zone_id: number;
	event_type: string;
	error_code: string | null;
}
export interface Session {
	id?: string;
	session_id: number;
	start_time: string;
	end_time?: string | null;
	area_covered_m2?: number | null;
	anomaly_rows?: number | null;
	bearing_wear: number;
	weather: string;
	duration_min?: number | null;
	ended_with_error?: string | null;
}
export interface SimulatorStatus {
	running: boolean;
	healthy: boolean;
	run_id: string | null;
	pending_writes: number;
}
export function mergeReadings(current: Reading[], incoming: Reading[], limit = 200): Reading[] {
	const unique = new Map(current.map((r) => [`${r.session_id}:${r.timestamp}`, r]));
	for (const row of incoming) unique.set(`${row.session_id}:${row.timestamp}`, row);
	return [...unique.values()]
		.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
		.slice(-limit);
}
export function chartPoints(
	rows: Reading[],
	key: 'battery_pct' | 'motor_current_a' | 'speed_mps',
	min: number,
	max: number
): string {
	if (!rows.length) return '';
	const start = Date.parse(rows[0].timestamp);
	const span = Math.max(1, Date.parse(rows.at(-1)!.timestamp) - start);
	return rows
		.map(
			(r) =>
				`${Math.round(((Date.parse(r.timestamp) - start) / span) * 10000) / 100},${Math.round((1 - Math.max(0, Math.min(1, (r[key] - min) / Math.max(max - min, 1)))) * 10000) / 100}`
		)
		.join(' ');
}
export function coverage(zones: Zone[]): number {
	const area = zones.reduce((n, z) => n + z.area_m2, 0);
	return area ? zones.reduce((n, z) => n + z.area_m2 * z.coverage_pct, 0) / area : 0;
}
export function zonePosition(id: number) {
	return {
		x: id <= 10 ? id - 1 : id <= 20 ? id - 11 : id - 21,
		y: id <= 10 ? 0 : id <= 20 ? 1 : 2
	};
}
export function formatTime(value: string | undefined) {
	return value
		? new Intl.DateTimeFormat('en-GB', {
				hour: '2-digit',
				minute: '2-digit',
				second: '2-digit',
				timeZone: 'UTC'
			}).format(new Date(value))
		: '—';
}
export function formatNumber(value: number | null | undefined, digits = 1) {
	return value == null ? '—' : value.toFixed(digits);
}
export function mergeEvents(current: MowerEvent[], incoming: MowerEvent[]): MowerEvent[] {
	const unique = new Map<string, MowerEvent>();
	for (const event of [...incoming, ...current])
		unique.set(`${event.session_id}:${event.timestamp}:${event.event_type}`, event);
	return [...unique.values()]
		.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
		.slice(0, 30);
}
