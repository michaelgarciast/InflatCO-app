/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unnecessary-type-assertion */
import { describe, expect, it, vi } from 'vitest';
import { proxy } from './proxy.ts';

const opts = (f: typeof fetch) => ({
	apiUrl: 'https://api.test',
	secret: 's'.repeat(32),
	clientIp: '1.2.3.4',
	fetch: f
});
const req = (init: RequestInit = {}, url = 'http://app/api/x?a=1') => new Request(url, init);

describe('proxy', () => {
	it('arma la URL con query y agrega secreto e IP', async () => {
		const f = vi.fn(async () => new Response('{}'));
		await proxy(req(), 'receipts', opts(f as never));
		const [url, init] = f.mock.calls[0] as unknown as [URL, RequestInit];
		expect(url.href).toBe('https://api.test/receipts?a=1');
		const h = init.headers as Headers;
		expect(h.get('X-Proxy-Secret')).toBe('s'.repeat(32));
		expect(h.get('X-Client-IP')).toBe('1.2.3.4');
	});

	it('no puede salir del origen de la API', async () => {
		const f = vi.fn();
		const res = await proxy(req(), '/evil.com/x', opts(f as never));
		expect(f).not.toHaveBeenCalled();
		expect(res.status).toBe(400);
	});

	it('reenvía solo la cookie de sesión y Content-Type', async () => {
		const f = vi.fn(async () => new Response('{}'));
		await proxy(
			req({
				headers: {
					cookie: 'a=1; __Host-session=abc',
					authorization: 'x',
					'content-type': 'application/json'
				}
			}),
			'me',
			opts(f as never)
		);
		const h = (f.mock.calls[0] as unknown as [URL, RequestInit])[1].headers as Headers;
		expect(h.get('Cookie')).toBe('__Host-session=abc');
		expect(h.get('Content-Type')).toBe('application/json');
		expect(h.has('Authorization')).toBe(false);
	});

	it('devuelve varios Set-Cookie y solo cabeceras permitidas', async () => {
		const upstream = new Headers({ 'content-type': 'application/json', 'x-secret': 'no' });
		upstream.append('set-cookie', 'a=1');
		upstream.append('set-cookie', 'b=2');
		const res = await proxy(
			req(),
			'me',
			opts((async () => new Response('{}', { headers: upstream })) as never)
		);
		expect(res.headers.getSetCookie()).toEqual(['a=1', 'b=2']);
		expect(res.headers.has('x-secret')).toBe(false);
		expect(res.headers.get('Cache-Control')).toBe('no-store');
	});

	it('204 sin body', async () => {
		const res = await proxy(
			req({ method: 'POST' }),
			'auth/sign-out',
			opts((async () => new Response(null, { status: 204 })) as never)
		);
		expect(res.status).toBe(204);
		expect(res.body).toBeNull();
	});

	it('401 por secreto → 500', async () => {
		const f = async () => new Response('{"message":"Invalid proxy secret"}', { status: 401 });
		vi.spyOn(console, 'error').mockImplementation(() => {});
		expect((await proxy(req(), 'me', opts(f as never))).status).toBe(500);
	});

	it('401 de sesión pasa tal cual', async () => {
		const f = async () => new Response('{"message":"Unauthorized"}', { status: 401 });
		expect((await proxy(req(), 'me', opts(f as never))).status).toBe(401);
	});

	it('API caída → 502', async () => {
		const f = async () => {
			throw new TypeError('fail');
		};
		const res = await proxy(req(), 'me', opts(f as never));
		expect(res.status).toBe(502);
	});
});
