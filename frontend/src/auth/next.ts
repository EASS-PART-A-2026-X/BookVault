/** Only accept same-app paths as a redirect target (never //evil.example or https://…). */
export function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}
