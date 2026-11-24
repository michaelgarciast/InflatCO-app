<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { api, ApiError } from '#lib/api.ts';

	const token = $derived(page.url.searchParams.get('token'));

	let email = $state('');
	let password = $state('');
	let password2 = $state('');
	let error = $state('');
	let sent = $state(false);
	let loading = $state(false);
	let slow = $state(false);

	const apiError = (e: unknown) =>
		e instanceof ApiError && e.status === 429
			? 'Demasiados intentos, espera un minuto'
			: e instanceof Error
				? e.message
				: 'Algo salió mal';

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (token && password !== password2) {
			error = 'Las contraseñas no coinciden';
			return;
		}
		loading = true;
		error = '';
		const timer = setTimeout(() => (slow = true), 5000);
		try {
			if (token) {
				await api('/auth/reset-password', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ token, password })
				});
				await goto(resolve('/login'));
			} else {
				await api('/auth/forgot-password', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ email })
				});
				sent = true;
			}
		} catch (e) {
			error = apiError(e);
		} finally {
			clearTimeout(timer);
			loading = false;
			slow = false;
		}
	}
</script>

{#if token}
	<form onsubmit={submit} class="space-y-4 pt-16">
		<h1 class="text-2xl font-semibold">Nueva contraseña</h1>
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
		<button
			disabled={loading}
			class="w-full rounded-lg bg-black p-3 text-white disabled:opacity-50"
		>
			{loading ? 'Guardando…' : 'Guardar contraseña'}
		</button>
	</form>
{:else if sent}
	<div class="space-y-4 pt-16">
		<h1 class="text-2xl font-semibold">Revisa tu correo</h1>
		<p class="text-gray-600">
			Si el correo está registrado, te llegó un enlace para restablecer la contraseña. El enlace
			vence en 1 hora.
		</p>
		<p class="text-center text-sm">
			<a href={resolve('/login')} class="underline">Volver a iniciar sesión</a>
		</p>
	</div>
{:else}
	<form onsubmit={submit} class="space-y-4 pt-16">
		<h1 class="text-2xl font-semibold">Recuperar contraseña</h1>
		<input
			type="email"
			required
			autocomplete="email"
			placeholder="Correo"
			bind:value={email}
			class="w-full rounded-lg border p-3"
		/>
		{#if error}<p class="text-red-600">{error}</p>{/if}
		{#if slow}<p class="text-gray-500">El servidor está despertando…</p>{/if}
		<button
			disabled={loading}
			class="w-full rounded-lg bg-black p-3 text-white disabled:opacity-50"
		>
			{loading ? 'Enviando…' : 'Enviar enlace'}
		</button>
		<p class="text-center text-sm">
			<a href={resolve('/login')} class="underline">Volver a iniciar sesión</a>
		</p>
	</form>
{/if}
