/** Ordered, bounded HTTP delivery for the standalone simulator. */
/**
 * @param {string} url
 * @param {string | undefined} token
 * @param {() => void} stop
 * @param {typeof fetch} transport
 */
export function createHttpSink(url, token, stop, transport = fetch) {
	let tail = Promise.resolve();
	let pending = 0;
	/** @type {unknown} */
	let failure = null;
	/** @param {unknown} message */
	const sink = (message) => {
		if (failure) return;
		if (pending >= 256) {
			failure = new Error('HTTP sink queue is full');
			stop();
			return;
		}
		pending++;
		tail = tail
			.then(async () => {
				if (failure) return;
				const response = await transport(url, {
					method: 'POST',
					headers: {
						'content-type': 'application/json',
						...(token ? { authorization: `Bearer ${token}` } : {})
					},
					body: JSON.stringify(message),
					signal: AbortSignal.timeout(10000)
				});
				await response.text();
				if (!response.ok) throw new Error(`HTTP ingestion failed: ${response.status}`);
			})
			.catch((error) => {
				failure = error;
				stop();
			})
			.finally(() => {
				pending--;
			});
	};
	sink.flush = async () => {
		await tail;
		if (failure) throw failure;
	};
	return sink;
}
