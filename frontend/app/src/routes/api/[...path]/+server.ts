import { API_URL, PROXY_SECRET } from '$app/env/private';
import { proxy } from '#lib/server/proxy.ts';
import type { RequestHandler } from './$types';

export const fallback: RequestHandler = ({ request, params, getClientAddress }) =>
	proxy(request, params.path, {
		apiUrl: API_URL,
		secret: PROXY_SECRET,
		clientIp: getClientAddress()
	});
