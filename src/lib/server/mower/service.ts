import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { PrismaClient } from '@prisma/client';
import { db } from '../db/index';
import { getSimulator, type MowerSimulator } from '../mower-simulator.js';
import { parseMessage, type MowerMessage } from './validation';
import { persistMessage } from './repository';
import { SerialQueue } from './queue';

export type LiveMessage = { type: string; data: unknown; run_id?: string };

/** Lifetime is process-wide, not request-wide: browsers only subscribe. */
export class MowerService {
	private emitter = new EventEmitter();
	private queue = new SerialQueue();
	private sim?: MowerSimulator;
	private runId: string | null = null;
	private initialization?: Promise<void>;
	private loop?: Promise<void>;
	private stopping?: Promise<void>;
	private failed = false;
	private latest: { reading: unknown; session: unknown; zones: unknown[] } = {
		reading: null,
		session: null,
		zones: []
	};
	constructor(
		private readonly database: PrismaClient,
		private readonly simulator = () => getSimulator({ speed: 10, fresh: true })
	) {
		this.emitter.setMaxListeners(0);
	}
	status() {
		return {
			run_id: this.runId,
			running: this.sim?.running ?? false,
			healthy: !this.failed,
			pending_writes: this.queue.pending
		};
	}
	snapshot() {
		return { ...this.latest, ...this.status() };
	}
	subscribe(listener: (message: LiveMessage) => void) {
		this.emitter.on('message', listener);
		return () => {
			this.emitter.off('message', listener);
		};
	}
	private fail(cause: unknown) {
		if (this.failed) return;
		this.failed = true;
		this.sim?.stop();
		console.error('Mower simulation stopped:', cause);
		this.emitter.emit('message', {
			type: 'error',
			data: {
				message:
					'Simulation stopped because persistence failed. Restart the server after fixing the cause.'
			}
		});
	}
	async start() {
		if (this.failed)
			throw new Error('Simulation unavailable; restart the server after fixing persistence');
		if (this.stopping) await this.stopping;
		if (!this.initialization)
			this.initialization = this.initialize().catch((error) => {
				this.fail(error);
				throw error;
			});
		await this.initialization;
		if (this.failed) throw new Error('Simulation unavailable');
		if (!this.sim!.running) {
			this.loop = this.sim!.start().catch((error) => this.fail(error));
		}
		await this.queue.drain();
	}
	private async initialize() {
		this.sim = this.simulator();
		const zones = parseMessage({ type: 'zones', data: this.sim.snapshot().zones });
		const id = randomUUID();
		await this.database.simulationRun.create({ data: { id, source: 'generate' } });
		await persistMessage(this.database, id, zones);
		this.runId = id;
		this.latest.zones = zones.data as unknown[];
		this.sim.on('message', (raw: unknown) => {
			if (this.failed) return;
			let message: MowerMessage;
			try {
				message = parseMessage(raw);
			} catch (error) {
				this.fail(error);
				return;
			}
			void this.queue
				.add(async () => {
					await persistMessage(this.database, id, message);
					if (message.type === 'reading') this.latest.reading = message.data;
					if (message.type === 'session_start' || message.type === 'session_end')
						this.latest.session = message.data;
					// Reload bounded zone state after committed writes for a consistent SSE handshake.
					if (message.type === 'reading' || message.type === 'event' || message.type === 'zones') {
						this.latest.zones = await this.database.zone.findMany({
							where: { run_id: id },
							orderBy: { zone_id: 'asc' }
						});
					}
					this.emitter.emit('message', { ...message, run_id: id });
				})
				.catch((error) => this.fail(error));
		});
	}
	async stop() {
		if (this.stopping) return this.stopping;
		this.stopping = (async () => {
			if (this.initialization) await this.initialization;
			this.sim?.stop();
			await this.loop;
			await this.queue.drain();
		})();
		try {
			await this.stopping;
		} finally {
			this.stopping = undefined;
		}
	}
}
const shared = globalThis as typeof globalThis & {
	mowerService?: MowerService;
	mowerIngestionQueue?: SerialQueue;
};
export function getMowerService() {
	return (shared.mowerService ??= new MowerService(db));
}
// External ingestion has an independent queue; validation conflicts don't poison it.
export async function ingestExternal(runId: string, message: MowerMessage) {
	const queue = (shared.mowerIngestionQueue ??= new SerialQueue());
	const result = await queue.add(async () => {
		try {
			await db.simulationRun.upsert({
				where: { id: runId },
				create: { id: runId, source: 'external' },
				update: {}
			});
			const inserted = await persistMessage(db, runId, message);
			return { inserted, error: null };
		} catch (error) {
			return { inserted: false, error };
		}
	});
	if (result.error) throw result.error;
	return result.inserted;
}
