// Customer-facing message templates (English & Spanish)
export type Lang = 'en' | 'es';

export function reviewSms(lang: Lang, shop: string, firstName: string, link: string): string {
  const name = firstName.trim() || (lang === 'es' ? 'amigo' : 'there');
  return lang === 'es'
    ? `¡Gracias por elegir ${shop}, ${name}! Si nos lo ganamos, una reseña rápida en Google nos ayuda mucho: ${link} Responda STOP para no recibir más mensajes.`
    : `Thanks for choosing ${shop}, ${name}! If we earned it, a quick Google review helps us a lot: ${link} Reply STOP to opt out.`;
}

export function signingSms(lang: Lang, shop: string, number: string, link: string): string {
  return lang === 'es'
    ? `${shop}: revise y firme su presupuesto #${number} aquí: ${link} (válido por 24 horas). Responda STOP para no recibir más mensajes.`
    : `${shop}: please review and sign estimate #${number} here: ${link} (valid for 24 hours). Reply STOP to opt out.`;
}

export function invoiceSms(lang: Lang, shop: string, number: string, link: string): string {
  return lang === 'es'
    ? `${shop}: su factura #${number} está lista: ${link} Responda STOP para no recibir más mensajes.`
    : `${shop}: your invoice #${number} is ready: ${link} Reply STOP to opt out.`;
}

export const STOP_WORDS = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'PARAR', 'DETENER'];
export const START_WORDS = ['START', 'YES', 'UNSTOP'];
