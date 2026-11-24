import type { Handle } from '@sveltejs/kit/hooks';

export const handle: Handle = async ({ event, resolve }) => {
	const res = await resolve(event);
	res.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
	res.headers.set('X-Content-Type-Options', 'nosniff');
	res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	res.headers.set('Permissions-Policy', 'camera=(self), geolocation=()');
	return res;
};
