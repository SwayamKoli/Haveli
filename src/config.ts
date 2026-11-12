/** Settings that are baked into the website at build time (see .env.example). */
export const DEMO = ['1', 'true'].includes(String(import.meta.env.VITE_DEMO ?? '').toLowerCase());
export const HOTEL_NAME: string = (import.meta.env.VITE_HOTEL_NAME as string | undefined)?.trim() || 'Haveli Residency';
