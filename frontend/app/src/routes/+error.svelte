<script lang="ts">
	import { page } from '$app/state';
</script>

<div class="space-y-4 py-12 text-center">
	<p>
		{page.status === 502
			? 'El servidor está despertando, intenta de nuevo en un momento'
			: page.error?.message}
	</p>
	<button class="rounded-lg bg-black px-6 py-3 text-white" onclick={() => location.reload()}>
		Reintentar
	</button>
</div>
