<script lang="ts">
	let { name, size = 20 }: { name: string; size?: number } = $props();
	const paths: Record<string, string> = {
		grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
		leaf: 'M20 3C9 2 3 7 5 14c2 6 10 6 13 0 2-4 2-8 2-11ZM4 21 15 9',
		chart: 'M4 3v17h17 M7 14l4-5 4 3 5-7',
		map: 'm3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2V5Zm6-2v16m6-14v16',
		clock: 'M12 8v5l3 2 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
		battery: 'M3 7h16v10H3z M22 10v4 M7 10v4m4-4v4',
		bolt: 'm13 2-8 12h6l-1 8 9-13h-7l1-7Z',
		speed: 'M4 18a9 9 0 1 1 16 0 M12 14l4-6 M10 18h4',
		alert: 'm12 3 10 18H2L12 3Zm0 6v5m0 3v.1',
		arrow: 'M5 12h14m-6-6 6 6-6 6',
		download: 'M12 3v12m-5-5 5 5 5-5 M4 16v5h16v-5',
		pause: 'M8 5v14M16 5v14',
		play: 'm7 4 13 8-13 8V4Z',
		refresh: 'M20 7a9 9 0 1 0 1 8 M20 2v6h-6',
		sun: 'M12 3V1m0 22v-2M3 12H1m22 0h-2M5 5 3 3m18 18-2-2M5 19l-2 2M21 3l-2 2 M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0Z'
	};
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="1.6"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"><path d={paths[name] ?? paths.leaf} /></svg
>
