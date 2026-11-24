export class ApiError extends Error {
	constructor(
		public status: number,
		message: string
	) {
		super(message);
	}
}

export async function api<T>(
	path: string,
	init?: RequestInit,
	f: typeof fetch = fetch
): Promise<T> {
	let res: Response;
	try {
		res = await f('/api' + path, init);
	} catch {
		throw new ApiError(0, 'No hay conexión con el servidor');
	}
	const body =
		res.status === 204
			? null
			: ((await res.json().catch(() => null)) as { message?: string | string[] } | null);
	if (!res.ok) {
		const m = body?.message;
		throw new ApiError(res.status, (Array.isArray(m) ? m.join('. ') : m) || 'Algo salió mal');
	}
	return body as T;
}
