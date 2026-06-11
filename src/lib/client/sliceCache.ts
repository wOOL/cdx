export type Plane = 'axial' | 'coronal' | 'sagittal';

export interface Slice {
	width: number;
	height: number;
	data: Int16Array;
}

const MAX_CACHED = 96;

/** Per-dataset slice fetch cache with in-flight dedupe. */
export class SliceCache {
	private cache = new Map<string, Slice>();
	private inflight = new Map<string, Promise<Slice>>();

	constructor(private datasetId: number) {}

	get(plane: Plane, index: number): Promise<Slice> {
		const key = `${plane}:${index}`;
		const hit = this.cache.get(key);
		if (hit) return Promise.resolve(hit);
		const pending = this.inflight.get(key);
		if (pending) return pending;

		const p = fetch(`/api/datasets/${this.datasetId}/slice/${plane}/${index}`)
			.then(async (res) => {
				if (!res.ok) throw new Error(`slice fetch failed: ${res.status}`);
				const width = Number(res.headers.get('X-Width'));
				const height = Number(res.headers.get('X-Height'));
				const buf = await res.arrayBuffer();
				const slice: Slice = { width, height, data: new Int16Array(buf) };
				this.cache.set(key, slice);
				while (this.cache.size > MAX_CACHED) {
					const oldest = this.cache.keys().next().value as string;
					this.cache.delete(oldest);
				}
				return slice;
			})
			.finally(() => this.inflight.delete(key));
		this.inflight.set(key, p);
		return p;
	}

	peek(plane: Plane, index: number): Slice | undefined {
		return this.cache.get(`${plane}:${index}`);
	}
}
