export const DEFAULT_THRESHOLDS = {
	minimum_samples: 30,
	anomaly_rate: 0.05,
	motor_current_a: 5,
	temperature_c: 50
};
export interface Summary {
	day?: string | Date;
	sample_count: number;
	anomaly_count: number;
	motor_current_sum: number;
	motor_current_max?: number;
	temperature_max: number;
	battery_sum?: number;
	battery_min?: number;
}
export function dailyValues(r: {
	timestamp: Date;
	motor_current_a: number;
	battery_temp_c: number;
	battery_pct: number;
	is_anomaly: boolean;
}) {
	return {
		day: new Date(r.timestamp.toISOString().slice(0, 10) + 'T00:00:00Z'),
		sample_count: 1,
		anomaly_count: r.is_anomaly ? 1 : 0,
		motor_current_sum: r.motor_current_a,
		motor_current_max: r.motor_current_a,
		temperature_max: r.battery_temp_c,
		battery_sum: r.battery_pct,
		battery_min: r.battery_pct
	};
}
export function freshness(
	received: string | null,
	observed: string | null,
	now = Date.now(),
	staleSeconds = 60
) {
	const recent = (v: string | null) =>
		!!v && now - Date.parse(v) <= staleSeconds * 1000 && Date.parse(v) <= now + staleSeconds * 1000;
	return { connected: recent(received), fresh: recent(observed) };
}
export function diagnostic(s: Summary | null, thresholds = DEFAULT_THRESHOLDS) {
	if (!s || s.sample_count < thresholds.minimum_samples) return 'Insufficient data';
	return s.anomaly_count / s.sample_count >= thresholds.anomaly_rate ||
		s.motor_current_sum / s.sample_count >= thresholds.motor_current_a ||
		s.temperature_max >= thresholds.temperature_c
		? 'Inspect machine'
		: 'No threshold exceeded';
}
export function trendDays(rows: Summary[], from: string, to: string) {
	const map = new Map(rows.map((r) => [new Date(r.day!).toISOString().slice(0, 10), r]));
	const days: Array<{
		day: string;
		sample_count: number | null;
		anomaly_rate: number | null;
		motor_current_mean: number | null;
		temperature_max: number | null;
	}> = [];
	for (let t = Date.parse(from + 'T00:00:00Z'); t <= Date.parse(to + 'T00:00:00Z'); t += 86400000) {
		const day = new Date(t).toISOString().slice(0, 10),
			r = map.get(day);
		days.push({
			day,
			sample_count: r?.sample_count ?? null,
			anomaly_rate: r?.sample_count ? r.anomaly_count / r.sample_count : null,
			motor_current_mean: r?.sample_count ? r.motor_current_sum / r.sample_count : null,
			temperature_max: r?.temperature_max ?? null
		});
	}
	return days;
}
