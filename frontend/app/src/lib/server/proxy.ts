const COOKIE = '__Host-session';

export type ProxyOptions = {
	apiUrl: string;
	secret: string;
	clientIp: string;
	fetch?: typeof fetch;
};

const json = (status: number, message: string) =>
	new Response(JSON.stringify({ message }), {
		status,
		headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
	});

export async function proxy(request: Request, path: string, opts: ProxyOptions): Promise<Response> {
	const base = new URL(opts.apiUrl);
	const target = new URL('/' + path + new URL(request.url).search, base);
	if (target.origin !== base.origin) return json(400, 'Ruta inválida');

	const headers = new Headers({ 'X-Proxy-Secret': opts.secret, 'X-Client-IP': opts.clientIp });
	const contentType = request.headers.get('content-type');
	if (contentType) headers.set('Content-Type', contentType);
	const session = request.headers
		.get('cookie')
		?.split(/;\s*/)
		.find((c) => c.startsWith(COOKIE + '='));
	if (session) headers.set('Cookie', session);

	const hasBody = request.body !== null && !['GET', 'HEAD'].includes(request.method);
	let res: Response;
	try {
		res = await (opts.fetch ?? fetch)(target, {
			method: request.method,
			headers,
			redirect: 'manual',
			...(hasBody && { body: request.body, duplex: 'half' })
		});
	} catch {
		return json(502, 'El servidor no responde, intenta de nuevo en un momento');
	}

	if (res.status === 401 && (await res.clone().text()).includes('proxy secret')) {
		console.error('El backend rechazó X-Proxy-Secret: revisa PROXY_SECRET');
		return json(500, 'Error de configuración del servidor');
	}

	const out = new Headers({ 'Cache-Control': 'no-store' });
	const type = res.headers.get('content-type');
	if (type) out.set('Content-Type', type);
	for (const c of res.headers.getSetCookie()) out.append('Set-Cookie', c);
	return new Response(res.status === 204 ? null : res.body, { status: res.status, headers: out });
}
