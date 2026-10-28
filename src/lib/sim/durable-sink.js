import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/** Disk-backed, single-producer ordered delivery. A successful HTTP acknowledgement
 * is the only operation that removes an envelope. Tokens are never written to disk.
 * @param {{directory:string,url:string,machineId:string,token:string,runId?:string,maxMessages?:number,maxBytes?:number,onFailure?:(e:Error)=>void,transport?:typeof fetch,sleep?:(ms:number)=>Promise<void>}} options
 */
export function createDurableSink(options) {
	const {
		directory,
		url,
		machineId,
		token,
		runId = randomUUID(),
		maxMessages = 100000,
		maxBytes = 128 * 1024 * 1024,
		onFailure = () => {},
		transport = fetch
	} = options;
	if (!machineId || !token) throw new Error('Machine ID and credential are required');
	fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
	const lock = path.join(directory, 'owner.lock');
	let lockFd;
	try {
		lockFd = fs.openSync(lock, 'wx', 0o600);
	} catch (e) {
		if (!(e instanceof Error) || !('code' in e) || e.code !== 'EEXIST') throw e;
		let owner;
		try {
			owner = JSON.parse(fs.readFileSync(lock, 'utf8'));
		} catch {
			throw new Error('Outbox in use or incomplete lock; inspect owner.lock');
		}
		let alive = true;
		try {
			process.kill(owner.pid, 0);
		} catch (err) {
			if (err instanceof Error && 'code' in err && err.code === 'ESRCH') alive = false;
		}
		if (alive) throw new Error('Outbox in use by another sender');
		fs.unlinkSync(lock);
		lockFd = fs.openSync(lock, 'wx', 0o600);
	}
	fs.writeFileSync(lockFd, JSON.stringify({ pid: process.pid, machineId, url }));
	fs.fsyncSync(lockFd);
	fs.closeSync(lockFd);
	const syncDir = () => {
		const fd = fs.openSync(directory, 'r');
		try {
			fs.fsyncSync(fd);
		} finally {
			fs.closeSync(fd);
		}
	};
	const metadata = path.join(directory, 'identity');
	try {
		if (fs.existsSync(metadata)) {
			const identity = JSON.parse(fs.readFileSync(metadata, 'utf8'));
			if (identity.machineId !== machineId || identity.url !== url)
				throw new Error('Outbox belongs to a different machine or endpoint');
		} else {
			fs.writeFileSync(metadata, JSON.stringify({ machineId, url }), { mode: 0o600 });
			const fd = fs.openSync(metadata, 'r');
			fs.fsyncSync(fd);
			fs.closeSync(fd);
			syncDir();
		}
	} catch (e) {
		fs.unlinkSync(lock);
		throw e;
	}
	let names = fs
		.readdirSync(directory)
		.filter((n) => /^\d{16}-[\da-f-]+\.json$/.test(n))
		.sort();
	let bytes = names.reduce((sum, n) => sum + fs.statSync(path.join(directory, n)).size, 0);
	let sequence = names.length ? Number(names[names.length - 1].slice(0, 16)) : 0;
	/** @type {Error|null} */ let failure = null;
	let closed = false;
	/** @type {Promise<void>|null} */ let worker = null;
	const abort = new AbortController();
	const sleep =
		options.sleep ??
		((ms) =>
			new Promise((resolve) => {
				const finish = () => {
					clearTimeout(timer);
					abort.signal.removeEventListener('abort', finish);
					resolve();
				};
				const timer = setTimeout(finish, ms);
				abort.signal.addEventListener('abort', finish, { once: true });
			}));
	/** @param {unknown} e */
	const fail = (e) => {
		failure = e instanceof Error ? e : new Error(String(e));
		onFailure(failure);
	};
	const pump = () => {
		if (worker || failure || closed || !names.length) return;
		worker = (async () => {
			let attempt = 0;
			while (names.length && !closed && !failure) {
				const filename = path.join(directory, names[0]);
				const body = fs.readFileSync(filename, 'utf8');
				const envelope = JSON.parse(body);
				// Filename UUID also upgrades old outboxes without changing replay identity.
				const messageId = envelope.message_id ?? names[0].slice(17, -5);
				try {
					const response = await transport(url, {
						method: 'POST',
						headers: {
							'content-type': 'application/json',
							authorization: `Bearer ${token}`,
							'x-machine-id': machineId,
							'x-run-id': envelope.run_id,
							'x-message-id': messageId
						},
						body: JSON.stringify(envelope.message),
						signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10000)])
					});
					if (response.status === 429 || response.status >= 500) {
						await response.text();
						throw new Error(`Transient ingestion failure ${response.status}`);
					}
					if (!response.ok) {
						fail(new Error(`HTTP ingestion rejected: ${response.status}; outbox retained`));
						break;
					}
					const acknowledgement = await response.json();
					if (
						acknowledgement.accepted !== true ||
						acknowledgement.run_id !== envelope.run_id ||
						acknowledgement.message_id !== messageId
					) {
						fail(new Error('Invalid ingestion acknowledgement; outbox retained'));
						break;
					}
					fs.unlinkSync(filename);
					syncDir();
					bytes -= Buffer.byteLength(body);
					names.shift();
					attempt = 0;
				} catch (e) {
					if (closed) break;
					await sleep(
						Math.min(30000, 500 * 2 ** Math.min(attempt++, 6) * (0.75 + Math.random() * 0.5))
					);
				}
			}
		})()
			.catch((e) => fail(e))
			.finally(() => {
				worker = null;
			});
	};
	/** @param {unknown} message */
	const sink = (message) => {
		if (closed) throw new Error('Outbox is closed');
		if (failure) throw failure;
		const messageId = randomUUID();
		const body = JSON.stringify({ run_id: runId, message_id: messageId, message });
		const size = Buffer.byteLength(body);
		if (names.length >= maxMessages || bytes + size > maxBytes) {
			const error = new Error('Outbox capacity exceeded; producer stopped, prior data retained');
			fail(error);
			throw error;
		}
		const name = `${String(++sequence).padStart(16, '0')}-${messageId}.json`;
		const temp = path.join(directory, name + '.tmp'),
			file = path.join(directory, name);
		const fd = fs.openSync(temp, 'wx', 0o600);
		try {
			fs.writeFileSync(fd, body);
			fs.fsyncSync(fd);
		} finally {
			fs.closeSync(fd);
		}
		fs.renameSync(temp, file);
		syncDir();
		names.push(name);
		bytes += size;
		pump();
	};
	sink.flush = async () => {
		pump();
		while (worker) await worker;
		if (failure) throw failure;
	};
	sink.close = async () => {
		if (closed) return;
		closed = true;
		abort.abort();
		if (worker) await worker;
		fs.unlinkSync(lock);
		syncDir();
	};
	pump();
	return sink;
}
