<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { api } from '#lib/api.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	async function signOut() {
		await api('/auth/sign-out', { method: 'POST' });
		await invalidateAll();
		await goto(resolve('/login'));
	}
</script>

<div class="flex items-center justify-between">
	<h1 class="text-xl font-semibold">Hola, {data.user?.email}</h1>
	<button class="rounded-lg border px-4 py-2" onclick={signOut}>Salir</button>
</div>
