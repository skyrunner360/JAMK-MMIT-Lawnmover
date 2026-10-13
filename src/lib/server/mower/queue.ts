/** One bounded, ordered write pipeline. A failure poisons the queue until restart. */
export class SerialQueue {
	private tail: Promise<void> = Promise.resolve();
	pending = 0;
	failure: unknown = null;
	constructor(private readonly capacity = 256) {}
	add<T>(work: () => Promise<T>): Promise<T> {
		if (this.failure) return Promise.reject(this.failure);
		if (this.pending >= this.capacity)
			return Promise.reject(new Error('Persistence queue is full'));
		this.pending++;
		const result = this.tail.then(async () => {
			if (this.failure) throw this.failure;
			return work();
		});
		this.tail = result
			.then(
				() => undefined,
				(error) => {
					this.failure = error;
				}
			)
			.finally(() => {
				this.pending--;
			});
		return result;
	}
	async drain() {
		await this.tail;
		if (this.failure) throw this.failure;
	}
}
