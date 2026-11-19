// NFC: un acento escrito como dos code points coincide con el guardado.
export const normalizeEmail = (email: string) => email.trim().normalize('NFC').toLowerCase();
