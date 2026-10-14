import {
	mergeReadings,
	mergeEvents,
	type Reading,
	type Zone,
	type MowerEvent,
	type Session,
	type SimulatorStatus
} from './data';

export class Dashboard {
	readings = $state<Reading[]>([]);
	events = $state<MowerEvent[]>([]);
	zones = $state<Zone[]>([]);
	sessions = $state<Session[]>([]);
	session = $state<Session | null>(null);
	status = $state<SimulatorStatus>({
		running: false,
		healthy: true,
		run_id: null,
		pending_writes: 0
	});
	connection = $state<'connecting' | 'live' | 'offline'>('connecting');
	loading = $state(true);
	busy = $state(false);
	error = $state('');
	private source?: EventSource;
	private timer?: ReturnType<typeof setInterval>;
	private abort = new AbortController();
	private disposed = false;
	private refreshing = false;
	private async request(path: string, action?: string) {
		const response = await fetch(path, {
			signal: this.abort.signal,
			...(action
				? {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({ action })
					}
				: {})
		});
		const body = await response.json();
		if (!response.ok) throw new Error(body.error ?? 'Unable to reach the mower service.');
		return body;
	}
	async initialize() {
		if (this.disposed) return;
		this.loading = true;
		this.error = '';
		try {
			const state = await this.request('/api/mower');
			this.status = state.simulator;
			if (!this.status.run_id) {
				this.status = (await this.request('/api/simulator', 'start')).data;
			}
			this.connect();
			await this.refresh();
			if (!this.timer)
				this.timer = setInterval(() => {
					void this.refresh();
				}, 10000);
		} catch (error) {
			this.report(error);
			this.connection = 'offline';
		} finally {
			this.loading = false;
		}
	}
	private connect() {
		this.source?.close();
		this.connection = 'connecting';
		const source = new EventSource('/api/stream?autostart=false');
		this.source = source;
		source.onopen = () => {
			if (!this.disposed) {
				this.connection = 'live';
				this.error = '';
			}
		};
		source.onerror = () => {
			if (!this.disposed) this.connection = 'offline';
		};
		source.onmessage = ({ data }) => {
			if (this.disposed) return;
			const message = JSON.parse(data);
			if (message.type === 'snapshot') {
				const snapshot = message.data;
				if (snapshot.run_id !== this.status.run_id) {
					this.readings = [];
					this.events = [];
				}
				this.status = {
					running: snapshot.running,
					healthy: snapshot.healthy,
					run_id: snapshot.run_id,
					pending_writes: snapshot.pending_writes
				};
				this.session = snapshot.session;
				this.zones = snapshot.zones;
				if (snapshot.reading) this.readings = mergeReadings(this.readings, [snapshot.reading]);
			} else if (message.type === 'reading') {
				this.readings = mergeReadings(this.readings, [message.data]);
			} else if (message.type === 'event') {
				this.events = mergeEvents(this.events, [message.data]);
			} else if (message.type === 'zones') {
				this.zones = message.data;
			} else if (message.type === 'session_start' || message.type === 'session_end') {
				this.session = message.data;
				void this.refresh();
			} else if (message.type === 'error') {
				this.error = message.data.message;
				this.status = { ...this.status, healthy: false, running: false };
				this.connection = 'offline';
				source.close();
			}
		};
	}
	async refresh() {
		if (this.refreshing || this.disposed) return;
		this.refreshing = true;
		try {
			const state = await this.request('/api/mower');
			if (this.disposed) return;
			if (this.status.run_id !== state.simulator.run_id) {
				this.readings = [];
				this.events = [];
			}
			this.status = state.simulator;
			this.zones = state.data.zones;
			this.session = state.data.session;
			const runId = this.status.run_id;
			if (!runId) return;
			const [readings, events, sessions] = await Promise.all([
				this.request(`/api/readings?run_id=${runId}&limit=200`),
				this.request(`/api/events?run_id=${runId}&limit=30`),
				this.request('/api/sessions?limit=20')
			]);
			if (this.disposed || runId !== this.status.run_id) return;
			this.readings = mergeReadings(this.readings, readings.data);
			this.events = mergeEvents(this.events, events.data);
			this.sessions = sessions.data;
		} catch (error) {
			this.report(error);
		} finally {
			this.refreshing = false;
		}
	}
	async control() {
		if (this.busy) return;
		this.busy = true;
		this.error = '';
		try {
			this.status = (
				await this.request('/api/simulator', this.status.running ? 'stop' : 'start')
			).data;
			if (!this.source || this.source.readyState === EventSource.CLOSED) this.connect();
			await this.refresh();
		} catch (error) {
			this.report(error);
		} finally {
			this.busy = false;
		}
	}
	private report(error: unknown) {
		if (!this.disposed)
			this.error = error instanceof Error ? error.message : 'Unable to load mower data.';
	}
	dispose() {
		this.disposed = true;
		this.abort.abort();
		this.source?.close();
		if (this.timer) clearInterval(this.timer);
	}
}
