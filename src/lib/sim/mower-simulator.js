// @ts-nocheck -- Supplied standalone JavaScript simulator; typed server boundary and runtime payload validation live in ../server.
/**
 * mower-simulator.js — real-time robotic lawnmower data simulator.
 *
 * Zero dependencies, ESM, Node >= 18. Works two ways:
 *
 *   1. As a SvelteKit server module (copy to src/lib/server/mower-simulator.js):
 *        import { getSimulator } from '$lib/server/mower-simulator.js';
 *        const sim = getSimulator({ speed: 5 });
 *        sim.on('reading', (r) => { ... });   // also: event, session_start, session_end, zones, message
 *        sim.start();
 *
 *   2. As a CLI:
 *        node mower-simulator.js --sink console,http --url http://localhost:5173/api/ingest --speed 10
 *
 * It learns its parameters from the four CSV files (main_log, events, sessions, zones):
 * zone layout/difficulty, event rates and mix, weather, wear progression, charging times.
 * Emitted objects use exactly the CSV column names.
 *
 * Sources:
 *   generate (default)  infinite synthetic sessions statistically matched to the CSVs
 *   replay              streams the original CSV rows in order (timestamps shifted to "now")
 */
import { EventEmitter } from 'node:events';
import { createHttpSink } from './http-sink.js';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

/* ------------------------------------------------------------------ constants */

const TICK_S = 10; // one main_log row every 10 s (as in the CSV)
const CUT_WIDTH_M = 0.25; // area_covered ≈ Σ speed * 10 s * 0.25 m
const M2_PER_TICK = 1.055; // zone area / dwell ticks, measured from the CSV
const GRID = { lon0: 24.65419, w: 0.000235, lat0: [60.20363, 60.20378, 60.20392], h: 0.00007 };
const DOCK = { lat: 60.203639, lon: 24.654208 };
// Boustrophedon order of zones over the 3-row grid (zones 1-10, 20-11, 21-26)
const PATH = [
	1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26
];

// Signal models fitted on the CSV (non-event mowing rows); residuals are white noise.
const FIT = {
	speed: (grass) => 0.4992 - 0.1591 * grass, // sd 0.020
	motor: (grass, slope, wear) =>
		2.0893 + 2.5759 * grass + 0.0539 * slope - 1.1145 * wear + 5.2266 * wear * wear, // sd 0.122 (wear effect is convex)
	current: (motor) => 1.7599 + 0.4074 * motor, // sd 0.074
	rpm: (grass, motor, speed) => 2785.7 - 256.7 * grass + 0.1376 * motor + 27.4 * speed, // sd 45
	voltage: (battery, current) => 21.9 + 0.033 * battery + 0.0001 * current, // sd 0.05
	drain: (current) => -0.0135 + 0.0371 * current // % per tick, sd 0.026
};

// Row signatures of each event type. Motor current during an event is a multiple of the
// tick's normal motor current (so events get more severe as the bearing wears);
// speed/rpm are [mean, sd, min, max]. Fitted on events1.csv + main_log1.csv.
const EVENT_FX = {
	obstacle_detected: {
		anomaly: false,
		ratio: 1.0,
		sd: 0.2,
		speed: [0.3, 0.1, 0, 0.45],
		rpm: [2644, 60, 2502, 2800]
	},
	bump: { anomaly: true, ratio: 1.3, sd: 0.13, rpm: [1473, 380, 806, 2171] },
	high_load: { anomaly: true, ratio: 2.2, sd: 0.13, rpm: [1459, 380, 810, 2521] },
	stall: { anomaly: true, ratio: 3.0, sd: 0.15, rpm: [1497, 380, 791, 2149] },
	unexpected_stop: { anomaly: true, ratio: 1.45, sd: 0.14, rpm: [1464, 380, 794, 2132] },
	lift: { anomaly: false, idle: true },
	tilt: { anomaly: false, idle: true }
};

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;
const fmtTs = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const parseTs = (s) => Date.parse(s.replace(' ', 'T') + 'Z');

/* ------------------------------------------------------------------ random */

function makeRng(seed) {
	let a = seed >>> 0;
	const next = () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	const rng = {
		next,
		uniform: (lo, hi) => lo + (hi - lo) * next(),
		int: (lo, hi) => Math.floor(lo + (hi - lo + 1) * next()),
		chance: (p) => next() < p,
		pick: (arr) => arr[Math.floor(next() * arr.length)],
		normal(mean = 0, sd = 1) {
			let u = 0;
			while (u === 0) u = next();
			return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
		},
		clipped: (m, sd, lo, hi) => clamp(rng.normal(m, sd), lo, hi),
		weighted(items, weights) {
			let r = next() * weights.reduce((s, w) => s + w, 0);
			for (let i = 0; i < items.length; i++) if ((r -= weights[i]) <= 0) return items[i];
			return items[items.length - 1];
		}
	};
	return rng;
}

/* ------------------------------------------------------------------ CSV + profile */

function coerce(v) {
	if (v === undefined || v === '') return null;
	if (v === 'True') return true;
	if (v === 'False') return false;
	return /^-?\d+(\.\d+)?([eE]-?\d+)?$/.test(v) ? Number(v) : v;
}

function splitLine(line) {
	const out = [];
	let cur = '';
	let quoted = false;
	for (let i = 0; i < line.length; i++) {
		const c = line[i];
		if (quoted) {
			if (c === '"') line[i + 1] === '"' ? ((cur += '"'), i++) : (quoted = false);
			else cur += c;
		} else if (c === '"') quoted = true;
		else if (c === ',') (out.push(cur), (cur = ''));
		else cur += c;
	}
	out.push(cur);
	return out;
}

export function parseCsv(text) {
	const lines = text.split(/\r?\n/).filter(Boolean);
	const columns = splitLine(lines[0]);
	const rows = lines.slice(1).map((l) => {
		const v = splitLine(l);
		return Object.fromEntries(columns.map((c, i) => [c, coerce(v[i])]));
	});
	return { columns, rows };
}

export const defaultDataDir = () => process.env.SIM_DATA_DIR ?? path.resolve(process.cwd(), 'data');

/** Loads main_log / events / sessions / zones CSVs (names may carry a numeric suffix, e.g. main_log1.csv). */
export function loadDataset(dir = defaultDataDir()) {
	const files = fs.readdirSync(dir);
	const read = (base) => {
		const f = files.filter((n) => new RegExp(`^${base}\\d*\\.csv$`).test(n)).sort()[0];
		if (!f) throw new Error(`Cannot find ${base}*.csv in ${path.resolve(dir)}`);
		return parseCsv(fs.readFileSync(path.join(dir, f), 'utf8'));
	};
	const [main, events, sessions, zones] = ['main_log', 'events', 'sessions', 'zones'].map(read);
	return { main, events, sessions, zones };
}

/** Derives all statistics the generator needs from the dataset. */
function buildProfile(ds) {
	const main = ds.main.rows;
	const events = ds.events.rows;
	const sessions = ds.sessions.rows;
	const zones = new Map(ds.zones.rows.map((z) => [z.zone_id, z]));
	const wearOf = new Map(sessions.map((s) => [s.session_id, s.bearing_wear]));

	const mowByZone = new Map();
	const chargeBySession = new Map();
	const firstRow = new Map();
	for (const r of main) {
		if (r.mode === 'mowing') mowByZone.set(r.zone_id, (mowByZone.get(r.zone_id) ?? 0) + 1);
		if (r.mode === 'charging')
			chargeBySession.set(r.session_id, (chargeBySession.get(r.session_id) ?? 0) + 1);
		if (!firstRow.has(r.session_id)) firstRow.set(r.session_id, r);
	}
	const totalMow = [...mowByZone.values()].reduce((a, b) => a + b, 0);
	const evByZone = new Map();
	for (const e of events) evByZone.set(e.zone_id, (evByZone.get(e.zone_id) ?? 0) + 1);
	const meanRate = events.length / totalMow;
	// per-zone event probability per mowing tick (zones with too little data fall back to the global mean)
	const zoneRate = new Map([...zones.keys()].map((id) => [id, meanRate]));
	for (const [id, n] of mowByZone) if (n > 300) zoneRate.set(id, (evByZone.get(id) ?? 0) / n);

	// Event-type mix at low vs high bearing wear (stall/high_load grow with wear, lift/tilt shrink)
	const types = [...new Set(events.map((e) => e.event_type))];
	const mix = (pred) => {
		const sel = events.filter((e) => pred(wearOf.get(e.session_id)));
		return types.map((t) => sel.filter((e) => e.event_type === t).length / Math.max(1, sel.length));
	};
	const errorCode = {};
	for (const e of events) if (e.error_code) errorCode[e.event_type] = e.error_code;

	const weatherPool = {};
	for (const s of sessions) {
		const r = firstRow.get(s.session_id);
		(weatherPool[s.weather] ??= []).push({ ambient: r.ambient_temp_c, humidity: r.humidity_pct });
	}
	const weatherNames = Object.keys(weatherPool);
	const wears = sessions.map((s) => s.bearing_wear);
	const days = sessions
		.slice(1)
		.map((s, i) => Math.round((parseTs(s.start_time) - parseTs(sessions[i].start_time)) / 864e5));

	return {
		zones,
		zoneRate,
		meanRate,
		eventTypes: types,
		mixLow: mix((w) => w <= 0.3),
		mixHigh: mix((w) => w >= 0.6),
		errorCode,
		weatherNames,
		weatherW: weatherNames.map((w) => weatherPool[w].length),
		weatherPool,
		wearStep: (Math.max(...wears) - Math.min(...wears)) / (sessions.length - 1),
		failWear: Math.max(...wears),
		chargeTicks: [...chargeBySession.values()],
		startHours: sessions.map((s) => new Date(parseTs(s.start_time)).getUTCHours()),
		gapDays: days.filter((d) => d > 0),
		lastSession: Math.max(...sessions.map((s) => s.session_id))
	};
}

/* ------------------------------------------------------------------ geometry */

function zoneBox(id) {
	const row = id <= 10 ? 0 : id <= 20 ? 1 : 2;
	const col = row === 0 ? id - 1 : row === 1 ? id - 11 : id - 21;
	return { row, col, lon0: GRID.lon0 + col * GRID.w, lat0: GRID.lat0[row] };
}

function zoneAt(lat, lon) {
	let row = 0;
	let best = Infinity;
	GRID.lat0.forEach((b, i) => {
		const d = Math.abs(lat - (b + GRID.h / 2));
		if (d < best) ((best = d), (row = i));
	});
	const col = clamp(Math.floor((lon - GRID.lon0) / GRID.w), 0, row === 2 ? 5 : 9);
	return row === 0 ? col + 1 : row === 1 ? 11 + col : 21 + col;
}

/* ------------------------------------------------------------------ live zone table */

class ZoneStats {
	constructor(zoneRows, fresh) {
		this.rows = new Map(zoneRows.map((z) => [z.zone_id, { ...z }]));
		if (fresh)
			for (const z of this.rows.values())
				Object.assign(z, {
					avg_motor_current_a: 0,
					avg_speed_mps: 0,
					time_spent_s: 0,
					anomaly_count: 0,
					obstacle_events: 0,
					coverage_pct: 0
				});
		// unrounded running sums so the averages don't drift from per-step rounding
		this.sums = new Map(
			[...this.rows].map(([id, z]) => [
				id,
				{
					motor: z.avg_motor_current_a * (z.time_spent_s / TICK_S),
					speed: z.avg_speed_mps * (z.time_spent_s / TICK_S)
				}
			])
		);
	}
	onReading(r) {
		const z = this.rows.get(r.zone_id);
		if (!z || r.mode === 'charging') return; // zones1.csv counts mowing + returning ticks
		const sum = this.sums.get(r.zone_id);
		sum.motor += r.motor_current_a;
		sum.speed += r.speed_mps;
		z.time_spent_s += TICK_S;
		const n = z.time_spent_s / TICK_S;
		z.avg_motor_current_a = round(sum.motor / n, 3);
		z.avg_speed_mps = round(sum.speed / n, 3);
		if (r.is_anomaly) z.anomaly_count++;
		z.coverage_pct = round(Math.min(100, (100 * n) / (5 * z.area_m2)), 1);
	}
	onEvent(e) {
		const z = this.rows.get(e.zone_id);
		if (z && (e.event_type === 'obstacle_detected' || e.event_type === 'bump')) z.obstacle_events++;
	}
	snapshot() {
		return [...this.rows.values()].map((z) => ({ ...z }));
	}
}

/* ------------------------------------------------------------------ simulator */

/**
 * @typedef {Object} SimOptions
 * @property {string}  [dataDir]       folder with the CSVs (default ./data or $SIM_DATA_DIR)
 * @property {'generate'|'replay'} [source]
 * @property {number}  [speed]         1 = real time (one row / 10 s); 10 = 10x faster; Infinity = as fast as possible
 * @property {number}  [gapSeconds]    wall-clock pause between sessions (default 15)
 * @property {number}  [sessions]      stop after N sessions (default: run forever)
 * @property {number}  [seed]          RNG seed for reproducible runs
 * @property {number}  [wear]          starting bearing_wear 0..1 (default 0.01; try 0.84 to see a failure soon)
 * @property {number}  [firstSession]  first session_id (default: last id in the CSV + 1)
 * @property {string|number} [start]   simulated start time (default: now)
 * @property {boolean} [fresh]         start the zones table from zero instead of the CSV totals
 * @property {Object}  [dataset]       pre-loaded result of loadDataset()
 */
export class MowerSimulator extends EventEmitter {
	#timer = null;
	#wake = null;
	#running = null;

	/** @param {SimOptions} [opts] */
	constructor(opts = {}) {
		super();
		this.opts = {
			source: 'generate',
			speed: 1,
			gapSeconds: 15,
			wear: 0.01,
			...opts
		};
		this.ds = opts.dataset ?? loadDataset(opts.dataDir);
		this.P = buildProfile(this.ds);
		this.rng = makeRng(opts.seed ?? Date.now());
		this.startMs = opts.start
			? typeof opts.start === 'number'
				? opts.start
				: Date.parse(opts.start)
			: Math.floor(Date.now() / 1000) * 1000;
		this.zones = new ZoneStats(this.ds.zones.rows, opts.fresh || this.opts.source === 'replay');
		this.latest = { reading: null, session: null };
		this.columns = {
			main_log: this.ds.main.columns,
			events: this.ds.events.columns,
			sessions: this.ds.sessions.columns,
			zones: this.ds.zones.columns
		};
	}

	get running() {
		return !!this.#running;
	}

	/** Current state, handy for a first paint / SSE handshake. */
	snapshot() {
		return { ...this.latest, zones: this.zones.snapshot() };
	}

	/** Starts streaming. Idempotent; resolves when the run ends (never, unless `sessions` is set or stop() is called). */
	start() {
		if (this.#running) return this.#running;
		this.#running = this.#loop().finally(() => (this.#running = null));
		return this.#running;
	}

	stop() {
		this.stopRequested = true;
		clearTimeout(this.#timer);
		this.#wake?.();
	}

	async #wait(ms) {
		if (ms <= 0) return;
		await new Promise((res) => {
			this.#wake = res;
			this.#timer = setTimeout(res, ms);
		});
	}

	async #loop() {
		this.stopRequested = false;
		const { speed, gapSeconds } = this.opts;
		const tickMs = (TICK_S * 1000) / speed;
		let nextAt = Date.now();
		let burst = 0;
		const it = (this.iterator ??=
			this.opts.source === 'replay' ? this.#replay() : this.#generate());
		while (!this.stopRequested) {
			const next = it.next();
			if (next.done) break;
			const msg = next.value;
			this.#dispatch(msg);
			if (msg.type === 'reading') {
				if (tickMs < 2) {
					if (++burst % 200 === 0) await new Promise(setImmediate); // don't starve the event loop
				} else {
					if (this.stopRequested) continue;
					nextAt += tickMs;
					if (nextAt < Date.now() - 1000) nextAt = Date.now(); // we fell behind, don't try to catch up
					await this.#wait(nextAt - Date.now());
				}
			} else if (msg.type === 'session_end') {
				if (!this.stopRequested) await this.#wait(gapSeconds * 1000);
				nextAt = Date.now();
			}
		}
	}

	#dispatch(msg) {
		const { type, data } = msg;
		if (type === 'session_start') this.latest.session = data;
		if (type === 'reading') {
			this.latest.reading = data;
			this.zones.onReading(data);
		}
		if (type === 'event') this.zones.onEvent(data);
		this.emit(type, data);
		this.emit('message', msg);
		if (type === 'session_end') {
			const zones = this.zones.snapshot();
			this.emit('zones', zones);
			this.emit('message', { type: 'zones', data: zones });
		}
	}

	/* ---------------------------------------------------------------- replay */

	*#replay() {
		const { main, events, sessions } = {
			main: this.ds.main.rows,
			events: this.ds.events.rows,
			sessions: this.ds.sessions.rows
		};
		const offset = this.startMs - parseTs(main[0].timestamp);
		const shift = (s) => fmtTs(parseTs(s) + offset);
		const group = (list, keyOf) => {
			const m = new Map();
			for (const x of list) {
				const k = keyOf(x);
				if (!m.has(k)) m.set(k, []);
				m.get(k).push(x);
			}
			return m;
		};
		const evByKey = group(events, (e) => `${e.session_id}|${e.timestamp}`);
		const rowsBySession = group(main, (r) => r.session_id);

		for (const s of sessions) {
			yield {
				type: 'session_start',
				data: {
					session_id: s.session_id,
					start_time: shift(s.start_time),
					weather: s.weather,
					bearing_wear: s.bearing_wear
				}
			};
			for (const r of rowsBySession.get(s.session_id) ?? []) {
				yield { type: 'reading', data: { ...r, timestamp: shift(r.timestamp) } };
				for (const e of evByKey.get(`${s.session_id}|${r.timestamp}`) ?? [])
					yield { type: 'event', data: { ...e, timestamp: shift(e.timestamp) } };
			}
			yield {
				type: 'session_end',
				data: { ...s, start_time: shift(s.start_time), end_time: shift(s.end_time) }
			};
		}
	}

	/* ---------------------------------------------------------------- generator */

	*#generate() {
		const { P, rng, opts } = this;
		let id = opts.firstSession ?? P.lastSession + 1;
		let wear = opts.wear;
		let clock = this.startMs;
		let pathIdx = rng.int(0, PATH.length - 1);

		for (let n = 0; !opts.sessions || n < opts.sessions; n++) {
			if (n > 0) {
				const d = new Date(clock);
				d.setUTCHours(0, 0, 0, 0);
				clock = d.getTime() + rng.pick(P.gapDays) * 864e5 + rng.pick(P.startHours) * 36e5;
			}
			const res = yield* this.#session(id++, wear, clock, pathIdx);
			clock = res.endMs;
			pathIdx = (res.pathIdx - rng.int(0, 2) + PATH.length) % PATH.length; // next run overlaps the end of the last one
			wear = res.failed ? 0.01 : clamp(wear + P.wearStep * rng.uniform(0.9, 1.1), 0, 1); // blades/bearing serviced after a failure
		}
	}

	*#session(id, wear, startMs, pathIdx) {
		const { P, rng } = this;
		const weather = rng.weighted(P.weatherNames, P.weatherW);
		const pool = rng.pick(P.weatherPool[weather]);
		const env = {
			ambient: round(pool.ambient + rng.normal(0, 0.5), 1),
			humidity: round(clamp(pool.humidity + rng.normal(0, 1.5), 20, 99), 1),
			rain: weather === 'rain'
		};
		const failing = wear >= P.failWear;
		const failAt = failing ? rng.int(250, 380) : Infinity; // session 71 in the CSV died after 314 mowing rows

		let t = startMs;
		let battery = rng.uniform(98.7, 99.9);
		let tempBase = env.ambient + rng.normal(5.6, 0.5);
		let heading = rng.uniform(0, 360);
		let pos = { lat: DOCK.lat, lon: DOCK.lon };
		let dev = { g: 0, s: 0, m: 0 }; // per-tick deviations from the zone means / fitted motor current
		const agg = {
			rows: 0,
			area: 0,
			motorSum: 0,
			motorN: 0,
			peak: 0,
			anomalies: 0,
			batteryStart: null,
			firstMs: t,
			lastMs: t,
			lastBattery: battery
		};

		const stepNoise = () => {
			dev.g = rng.normal(0.027, 0.053);
			dev.s = rng.normal(0, 0.6);
			dev.m = rng.normal(0, 0.122);
		};
		const terrain = (zone) => {
			const z = P.zones.get(zone);
			return {
				grass: clamp((z?.grass_density ?? 0.55) + dev.g, 0.25, 0.98),
				slope: clamp((z?.avg_slope_deg ?? 5) + dev.s, 0.1, 11.8)
			};
		};
		const makeRow = (mode, f) => ({
			timestamp: fmtTs(t),
			session_id: id,
			latitude: round(f.lat, 6),
			longitude: round(f.lon, 6),
			speed_mps: round(f.speed, 3),
			heading_deg: round(f.heading, 1),
			mode,
			battery_pct: round(f.battery, 2),
			voltage_v: round(f.voltage, 2),
			current_a: round(f.current, 3),
			battery_temp_c: round(f.temp, 1),
			motor_current_a: round(f.motor, 3),
			motor_rpm: Math.max(0, Math.round(f.rpm)),
			slope_deg: round(f.slope, 1),
			grass_load: round(f.grass, 2),
			ambient_temp_c: env.ambient,
			humidity_pct: env.humidity,
			rain: env.rain,
			zone_id: f.zone,
			is_anomaly: !!f.anomaly
		});
		const noisyPos = () => ({
			lat: pos.lat + rng.normal(0, 4e-6),
			lon: pos.lon + rng.normal(0, 2e-5)
		});

		yield {
			type: 'session_start',
			data: { session_id: id, start_time: fmtTs(t), weather, bearing_wear: round(wear, 4) }
		};

		/* ---- mowing ---- */
		let zi = pathIdx;
		let zoneTick = 0;
		const dwellOf = (zone) =>
			Math.round(((P.zones.get(zone)?.area_m2 ?? 150) / M2_PER_TICK) * rng.uniform(0.95, 1.05));
		let dwell = dwellOf(PATH[zi]);
		let failed = false;

		for (let tick = 0; ; tick++) {
			const zone = PATH[zi];
			const box = zoneBox(zone);
			const p = zoneTick / dwell;
			const sweep = box.row === 1 ? 1 - p : p; // middle row is mown east -> west
			pos = {
				lat: box.lat0 + GRID.h * (0.5 + 0.5 * Math.sin(p * Math.PI * 6)),
				lon: box.lon0 + sweep * GRID.w
			};
			heading = (heading + rng.normal(0, 12) + (rng.chance(0.02) ? 180 : 0) + 360) % 360;
			stepNoise();
			const { grass, slope } = terrain(zone);

			let speed = clamp(FIT.speed(grass) + rng.normal(0, 0.02), 0.28, 0.52);
			let motor = FIT.motor(grass, slope, wear) + dev.m;
			let current = FIT.current(motor) + rng.normal(0, 0.074);
			let rpm = FIT.rpm(grass, motor, speed) + rng.normal(0, 45);
			const drainCurrent = current; // events spike the current but barely change battery use
			let anomaly = false;
			let event = null;

			// events: per-zone base rate, mildly increasing with wear; the dying session ends on a high_load
			if (tick === failAt) event = 'high_load';
			else if (rng.chance((P.zoneRate.get(zone) ?? P.meanRate) * (0.9 + 0.2 * wear))) {
				const f = clamp((wear - 0.15) / 0.65, 0, 1);
				const w = P.eventTypes.map((_, i) => P.mixLow[i] + (P.mixHigh[i] - P.mixLow[i]) * f);
				event = rng.weighted(P.eventTypes, w);
			}
			if (event) {
				const fx = EVENT_FX[event];
				anomaly = fx.anomaly;
				if (fx.idle) {
					speed = 0;
					rpm = 0;
					motor = rng.uniform(0.19, 0.45);
					current = rng.uniform(1.01, 1.41);
				} else {
					motor = Math.max(
						motor + 0.3,
						motor * rng.normal(tick === failAt ? 2.9 : fx.ratio, fx.sd)
					);
					rpm = rng.clipped(...fx.rpm.slice(0, 2), ...fx.rpm.slice(2));
					speed = fx.speed ? rng.clipped(...fx.speed) : rng.chance(0.7) ? 0 : rng.uniform(0, 0.28);
					current = anomaly
						? 1.12 + 0.4226 * motor + rng.normal(0, 0.15)
						: FIT.current(motor) + rng.normal(0, 0.074);
				}
			}

			const voltage = FIT.voltage(battery, current) + rng.normal(0, 0.05);
			tempBase += (env.ambient + 15 - tempBase) * 0.0018;
			const shown = noisyPos();
			const row = makeRow('mowing', {
				...shown,
				speed,
				heading,
				battery,
				voltage,
				current,
				temp: tempBase + rng.normal(0, 0.45),
				motor,
				rpm,
				slope,
				grass,
				zone,
				anomaly
			});
			yield { type: 'reading', data: row };
			if (event) {
				yield {
					type: 'event',
					data: {
						timestamp: row.timestamp,
						session_id: id,
						latitude: row.latitude,
						longitude: row.longitude,
						event_type: event,
						error_code: P.errorCode[event] ?? null,
						zone_id: zone
					}
				};
			}

			agg.rows++;
			agg.area += speed * TICK_S * CUT_WIDTH_M;
			agg.motorSum += row.motor_current_a;
			agg.motorN++;
			agg.peak = Math.max(agg.peak, row.motor_current_a);
			agg.anomalies += anomaly ? 1 : 0;
			agg.batteryStart ??= row.battery_pct;
			agg.lastMs = t;
			agg.lastBattery = row.battery_pct;

			battery -= Math.max(0.03, FIT.drain(drainCurrent) + rng.normal(0, 0.0258));
			t += TICK_S * 1000;
			if (++zoneTick >= dwell) {
				zi = (zi + 1) % PATH.length;
				zoneTick = 0;
				dwell = dwellOf(PATH[zi]);
			}
			if (tick === failAt) {
				failed = true;
				break;
			}
			if (battery <= 22.0) break;
		}

		/* ---- returning to the dock + charging ----
       In the CSV the return leg lasts until the battery reaches ~9.5 % (≈ 207 rows at 0.46 m/s),
       so it is battery-driven; the position is interpolated from where mowing stopped to the dock. */
		if (!failed) {
			const from = { ...pos };
			const b0 = battery;
			while (battery > 9.5) {
				const progress = clamp((b0 - battery) / (b0 - 9.5), 0, 1);
				pos = {
					lat: from.lat + (DOCK.lat - from.lat) * progress,
					lon: from.lon + (DOCK.lon - from.lon) * progress
				};
				const zone = zoneAt(pos.lat, pos.lon);
				stepNoise();
				const { grass, slope } = terrain(zone);
				const speed = rng.clipped(0.46, 0.03, 0.325, 0.586);
				const current = rng.normal(2.04, 0.08);
				heading =
					((Math.atan2(
						(DOCK.lon - pos.lon) * Math.cos((pos.lat * Math.PI) / 180),
						DOCK.lat - pos.lat
					) *
						180) /
						Math.PI +
						360 +
						rng.normal(0, 8)) %
					360;
				tempBase += (env.ambient + 15 - tempBase) * 0.0018;
				const row = makeRow('returning', {
					lat: pos.lat + rng.normal(0, 3e-6),
					lon: pos.lon + rng.normal(0, 3e-6),
					speed,
					heading,
					battery,
					voltage: 22.0 + 0.02 * battery + rng.normal(0, 0.05),
					current,
					temp: tempBase + rng.normal(0, 0.45),
					motor: rng.normal(0.6, 0.08),
					rpm: 0,
					slope,
					grass,
					zone
				});
				yield { type: 'reading', data: row };
				agg.lastMs = t;
				agg.lastBattery = row.battery_pct;
				battery -= Math.max(0.03, FIT.drain(current) + rng.normal(0, 0.01));
				t += TICK_S * 1000;
			}

			const zone = zoneAt(DOCK.lat, DOCK.lon);
			for (let c = rng.pick(P.chargeTicks); c > 0; c--) {
				stepNoise();
				const { grass, slope } = terrain(zone);
				tempBase += (env.ambient + 12 - tempBase) * 0.0018;
				const row = makeRow('charging', {
					lat: DOCK.lat,
					lon: DOCK.lon,
					speed: 0,
					heading,
					battery,
					voltage: 21.8 + 0.035 * battery + rng.normal(0, 0.05),
					current: rng.normal(-2.4, 0.1),
					temp: tempBase + rng.normal(0, 0.45),
					motor: rng.clipped(0.25, 0.04, 0.1, 0.39),
					rpm: 0,
					slope,
					grass,
					zone
				});
				yield { type: 'reading', data: row };
				agg.lastMs = t;
				agg.lastBattery = row.battery_pct;
				battery += 0.54 + rng.normal(0, 0.02);
				t += TICK_S * 1000;
			}
		}

		yield {
			type: 'session_end',
			data: {
				session_id: id,
				start_time: fmtTs(startMs),
				end_time: fmtTs(agg.lastMs),
				duration_min: Math.floor((agg.lastMs - agg.firstMs) / 60000),
				weather,
				battery_start_pct: agg.batteryStart,
				battery_end_pct: agg.lastBattery,
				rows: Math.round((agg.lastMs - agg.firstMs) / (TICK_S * 1000)) + 1,
				area_covered_m2: round(agg.area, 1),
				mean_motor_current_a: round(agg.motorSum / agg.motorN, 3),
				peak_motor_current_a: round(agg.peak, 3),
				anomaly_rows: agg.anomalies,
				bearing_wear: round(wear, 4),
				sessions_to_failure: failed
					? null
					: Math.max(0, Math.ceil((P.failWear - wear) / P.wearStep)),
				ended_with_error: failed ? 'E-12' : null
			}
		};
		return { endMs: t, failed, pathIdx: zi };
	}
}

/** Process-wide singleton (survives Vite HMR / multiple imports). */
export function getSimulator(opts) {
	return (globalThis.__mowerSimulator ??= new MowerSimulator(opts));
}

/* ------------------------------------------------------------------ CLI */

const HELP = `
Usage: node mower-simulator.js [options]

  --data-dir <dir>     folder with the CSVs               (default ./data or $SIM_DATA_DIR)
  --source <s>         generate | replay                  (default generate)
  --speed <x>          1 = real time, 10 = 10x, Infinity  (default 1)
  --sink <list>        console,jsonl,http,csv             (default console)
  --url <url>          POST target for the http sink; body is {"type","data"}
  --out-dir <dir>      folder for the csv sink            (default ./sim_out)
  --sessions <n>       stop after n sessions              (default: forever)
  --gap-seconds <s>    wall-clock pause between sessions  (default 15)
  --wear <0..1>        starting bearing wear              (default 0.01; 0.84 -> failure soon)
  --seed <n>           reproducible run
  --start <iso>        simulated start time               (default now)
  --first-session <n>  first session_id                   (default last CSV id + 1)
  HTTP authentication: set MOWER_INGEST_TOKEN in the environment.
  --fresh              zones table starts from zero
`;

function csvCell(v) {
	if (v === null || v === undefined) return '';
	if (typeof v === 'boolean') return v ? 'True' : 'False';
	const s = String(v);
	return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function makeSinks(names, v, sim) {
	const sinks = [];
	for (const name of names) {
		if (name === 'console') {
			sinks.push(({ type, data: d }) => {
				const time = d.timestamp?.slice(11) ?? '';
				if (type === 'session_start')
					console.log(
						`\n▶ session ${d.session_id} start  ${d.start_time}  weather=${d.weather}  wear=${d.bearing_wear}`
					);
				else if (type === 'reading')
					console.log(
						`${time}  s${d.session_id} ${d.mode.padEnd(9)} z${String(d.zone_id).padEnd(2)} bat ${d.battery_pct.toFixed(2).padStart(5)}%  ${d.speed_mps.toFixed(2)} m/s  motor ${d.motor_current_a.toFixed(2)} A  ${d.battery_temp_c} °C${d.is_anomaly ? '  ANOMALY' : ''}`
					);
				else if (type === 'event')
					console.log(
						`${time}  ⚠ ${d.event_type}${d.error_code ? ` (${d.error_code})` : ''} in zone ${d.zone_id}`
					);
				else if (type === 'session_end')
					console.log(
						`■ session ${d.session_id} end    ${d.end_time}  ${d.duration_min} min, ${d.area_covered_m2} m², ${d.anomaly_rows} anomalies${d.ended_with_error ? `, ENDED WITH ${d.ended_with_error}` : ''}`
					);
			});
		} else if (name === 'jsonl') {
			sinks.push((m) => process.stdout.write(JSON.stringify(m) + '\n'));
		} else if (name === 'http') {
			if (!v.url) throw new Error('--sink http needs --url');
			sinks.push(createHttpSink(v.url, process.env.MOWER_INGEST_TOKEN, () => sim.stop()));
		} else if (name === 'csv') {
			const dir = v['out-dir'];
			fs.mkdirSync(dir, { recursive: true });
			const target = {
				reading: ['main_log', 'main_log_live.csv'],
				event: ['events', 'events_live.csv'],
				session_end: ['sessions', 'sessions_live.csv']
			};
			const write = (file, cols, rows, append) => {
				const p = path.join(dir, file);
				const body = rows.map((r) => cols.map((c) => csvCell(r[c])).join(',')).join('\n') + '\n';
				if (append && fs.existsSync(p)) fs.appendFileSync(p, body);
				else fs.writeFileSync(p, cols.join(',') + '\n' + body);
			};
			for (const [, f] of Object.values(target)) fs.rmSync(path.join(dir, f), { force: true });
			sinks.push(({ type, data }) => {
				if (target[type]) write(target[type][1], sim.columns[target[type][0]], [data], true);
				if (type === 'zones') write('zones_live.csv', sim.columns.zones, data, false);
			});
		} else throw new Error(`Unknown sink "${name}"`);
	}
	return sinks;
}

async function main() {
	const { values: v } = parseArgs({
		options: {
			'data-dir': { type: 'string' },
			source: { type: 'string', default: 'generate' },
			speed: { type: 'string', default: '1' },
			sink: { type: 'string', default: 'console' },
			url: { type: 'string' },
			'out-dir': { type: 'string', default: 'sim_out' },
			sessions: { type: 'string' },
			'gap-seconds': { type: 'string', default: '15' },
			wear: { type: 'string' },
			seed: { type: 'string' },
			start: { type: 'string' },
			'first-session': { type: 'string' },
			fresh: { type: 'boolean' },
			help: { type: 'boolean', short: 'h' }
		}
	});
	if (v.help) return console.log(HELP);
	const num = (s) => (s === undefined ? undefined : Number(s));
	const sim = new MowerSimulator({
		dataDir: v['data-dir'],
		source: v.source,
		speed: num(v.speed),
		gapSeconds: num(v['gap-seconds']),
		sessions: num(v.sessions),
		wear: num(v.wear) ?? 0.01,
		seed: num(v.seed),
		start: v.start,
		firstSession: num(v['first-session']),
		fresh: v.fresh
	});
	process.stdout.on('error', (e) => e.code === 'EPIPE' && process.exit(0));
	const sinks = makeSinks(v.sink.split(','), v, sim);
	// Initialize zone relations before sending any session telemetry.
	for (const sink of sinks) sink({ type: 'zones', data: sim.snapshot().zones });
	await Promise.all(sinks.map((sink) => sink.flush?.()));
	sim.on('message', (m) => sinks.forEach((s) => s(m)));
	process.on('SIGINT', () => (sim.stop(), console.error('\nstopping…')));
	await sim.start();
	await Promise.all(sinks.map((sink) => sink.flush?.()));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	main().catch((err) => (console.error(err.message), process.exit(1)));
}
