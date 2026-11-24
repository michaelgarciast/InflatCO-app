<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { api, ApiError } from '#lib/api.ts';

	let email = $state('');
	let password = $state('');
	let error = $state('');
	let loading = $state(false);
	let slow = $state(false);

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		loading = true;
		error = '';
		const timer = setTimeout(() => (slow = true), 5000);
		try {
			await api('/auth/sign-in', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email, password })
			});
			const to = page.url.searchParams.get('redirectTo') ?? '/';
			await invalidateAll();
			await goto(resolve((/^\/(?![/\\])/.test(to) ? to : '/') as '/'));
		} catch (e) {
			const status = e instanceof ApiError ? e.status : 0;
			error =
				status === 401
					? 'Correo o contraseña incorrectos'
					: status === 429
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
	<h1 class="text-2xl font-semibold">Iniciar sesión</h1>
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
		autocomplete="current-password"
		placeholder="Contraseña"
		bind:value={password}
		class="w-full rounded-lg border p-3"
	/>
	{#if error}<p class="text-red-600">{error}</p>{/if}
	{#if slow}<p class="text-gray-500">El servidor está despertando…</p>{/if}
	<button disabled={loading} class="w-full rounded-lg bg-black p-3 text-white disabled:opacity-50">
		{loading ? 'Entrando…' : 'Entrar'}
	</button>
	<p class="text-center text-sm">
		<a href={resolve('/recuperar')} class="underline">¿Olvidaste tu contraseña?</a>
	</p>
	<p class="text-center text-sm">
		¿No tienes cuenta? <a href={resolve('/registro')} class="underline">Regístrate</a>
	</p>
</form>
