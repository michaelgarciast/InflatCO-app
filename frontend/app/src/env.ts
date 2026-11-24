import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
	API_URL: {
		schema: (value) => {
			if (!value) throw new Error('API_URL es obligatoria');
			return new URL(value).origin;
		}
	},
	PROXY_SECRET: {
		schema: (value) => {
			if (!value || value.length < 32)
				throw new Error('PROXY_SECRET debe tener al menos 32 caracteres');
			return value;
		}
	}
});
