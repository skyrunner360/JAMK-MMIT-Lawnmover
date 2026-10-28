import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { PrismaClient } from '@prisma/client';
import { db } from '../db/index';
import { MowerSimulator } from '../mower-simulator.js';
import { parseMessage, type MowerMessage } from './validation';
import { IngestionConflict, persistMessage } from './repository';
import { SerialQueue } from './queue';
import { ensureDemoFleet, createRun, DEMO_MACHINE } from './fleet';

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
		private readonly simulator = () => new MowerSimulator({ speed: 10, fresh: true })
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

		if (this.runId) {
			const run = await this.database.simulationRun.findUnique({
				where: { id: this.runId },
				include: { cycle: true }
			});
			if (run?.cycle?.completed_at)
				throw new IngestionConflict(
					'This mowing cycle is complete. Start a new mowing cycle before resuming the simulator.'
				);
		}
		if (!this.sim!.running) {
			this.loop = this.sim!.start().catch((error) => this.fail(error));
		}
		await this.queue.drain();
	}
	private async initialize() {
		this.sim = this.simulator();
		const zones = parseMessage({ type: 'zones', data: this.sim.snapshot().zones });
		const id = randomUUID();
		await ensureDemoFleet(this.database);
		await createRun(this.database, id, DEMO_MACHINE, 'generate');
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
	async rollover() {
		const resume = this.sim?.running ?? false;
		await this.stop();
		this.initialization = undefined;
		this.sim = undefined;
		this.runId = null;
		this.latest = { reading: null, session: null, zones: [] };
		if (resume) await this.start();
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
// Database advisory locks serialize each machine across server processes.
export async function ingestExternal(
	runId: string,
	message: MowerMessage,
	machineId = DEMO_MACHINE,
	delivery?: { message_id: string }
) {
	const run = await db.simulationRun.findUnique({ where: { id: runId } });
	if (run && run.machine_id !== machineId)
		throw new IngestionConflict('Run belongs to another machine');
	await createRun(db, runId, machineId, 'external');
	return persistMessage(db, runId, message, delivery);
}
