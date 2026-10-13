import { EventEmitter } from 'node:events';
export interface SimOptions {
	dataDir?: string;
	source?: 'generate' | 'replay';
	speed?: number;
	gapSeconds?: number;
	sessions?: number;
	seed?: number;
	wear?: number;
	firstSession?: number;
	start?: string | number;
	fresh?: boolean;
	dataset?: Dataset;
}
export interface Dataset {
	main: CsvTable;
	events: CsvTable;
	sessions: CsvTable;
	zones: CsvTable;
}
export interface CsvTable {
	columns: string[];
	rows: Record<string, unknown>[];
}
export interface SimSnapshot {
	reading: Record<string, unknown> | null;
	session: Record<string, unknown> | null;
	zones: Record<string, unknown>[];
}
export class MowerSimulator extends EventEmitter {
	constructor(options?: SimOptions);
	readonly running: boolean;
	snapshot(): SimSnapshot;
	start(): Promise<void>;
	stop(): void;
}
export function getSimulator(options?: SimOptions): MowerSimulator;
export function loadDataset(dir?: string): Dataset;
export function parseCsv(text: string): CsvTable;
