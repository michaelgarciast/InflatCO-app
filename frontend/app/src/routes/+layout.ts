import { error, redirect } from '@sveltejs/kit';
import { api, ApiError } from '#lib/api.ts';
import type { User } from '#lib/types.ts';
import type { LayoutLoad } from './$types';

export const ssr = false;

export const load: LayoutLoad = async ({ fetch, url }) => {
	try {
		const user = await api<User>('/me', undefined, fetch);
		return { user };
	} catch (e) {
		if (!(e instanceof ApiError)) throw e;
		if (e.status === 401) {
			if (['/login', '/registro'].includes(url.pathname)) return { user: null };
			const to = url.pathname + url.search;
			redirect(307, to === '/' ? '/login' : `/login?redirectTo=${encodeURIComponent(to)}`);
		}
		error(e.status || 502, e.message);
	}
};
