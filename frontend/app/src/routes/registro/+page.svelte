<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { api, ApiError } from '#lib/api.ts';

	let email = $state('');
	let password = $state('');
	let password2 = $state('');
	let error = $state('');
	let loading = $state(false);
	let slow = $state(false);

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (password !== password2) {
			error = 'Las contraseñas no coinciden';
			return;
		}
		loading = true;
		error = '';
		const timer = setTimeout(() => (slow = true), 5000);
		try {
			await api('/auth/sign-up', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email, password })
			});
			await invalidateAll();
			await goto(resolve('/'));
		} catch (e) {
			error =
				e instanceof ApiError && e.status === 429
					? 'Demasiados intentos, espera un minuto'
					: e instanceof Error
						? e.message
						: 'Algo salió mal';
		} finally {
			clearTimeout(timer);
			loading = false;
			slow = false;
		}
	}
</script>

<form onsubmit={submit} class="space-y-4 pt-16">
	<h1 class="text-2xl font-semibold">Crear cuenta</h1>
	<input
		type="email"
		required
		autocomplete="email"
		placeholder="Correo"
		bind:value={email}
		class="w-full rounded-lg border p-3"
	/>
	<input
		type="password"
		required
		minlength="12"
		autocomplete="new-password"
		placeholder="Contraseña (mínimo 12 caracteres)"
		bind:value={password}
		class="w-full rounded-lg border p-3"
	/>
	<input
		type="password"
		required
		minlength="12"
		autocomplete="new-password"
		placeholder="Repetir contraseña"
		bind:value={password2}
		class="w-full rounded-lg border p-3"
	/>
	{#if error}<p class="text-red-600">{error}</p>{/if}
	{#if slow}<p class="text-gray-500">El servidor está despertando…</p>{/if}
	<button disabled={loading} class="w-full rounded-lg bg-black p-3 text-white disabled:opacity-50">
		{loading ? 'Creando cuenta…' : 'Crear cuenta'}
	</button>
	<p class="text-center text-sm">
		¿Ya tienes cuenta? <a href={resolve('/login')} class="underline">Inicia sesión</a>
	</p>
</form>
