// Para ILIKE: sin esto, `%` y `_` del usuario actúan como comodines.
export const escapeLike = (value: string) => value.replace(/[\\%_]/g, '\\$&');
