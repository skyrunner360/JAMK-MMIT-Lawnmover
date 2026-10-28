import { DEFAULT_THRESHOLDS } from '../../dashboard/fleet';
export function healthThresholds(env: Record<string, string | undefined> = process.env) {
	const positive = (key: string, fallback: number, max = Infinity) => {
		const value = Number(env[key]);
		return Number.isFinite(value) && value > 0 && value <= max ? value : fallback;
	};
	return {
		minimum_samples: Math.ceil(
			positive('MOWER_HEALTH_MIN_SAMPLES', DEFAULT_THRESHOLDS.minimum_samples)
		),
		anomaly_rate: positive('MOWER_HEALTH_ANOMALY_RATE', DEFAULT_THRESHOLDS.anomaly_rate, 1),
		motor_current_a: positive('MOWER_HEALTH_MOTOR_CURRENT_A', DEFAULT_THRESHOLDS.motor_current_a),
		temperature_c: positive('MOWER_HEALTH_TEMPERATURE_C', DEFAULT_THRESHOLDS.temperature_c)
	};
}
