/** Initials in a steel ring; the colour is stable per username. */
export function Avatar({
  name,
  username,
  size = 'md',
}: {
  name: string;
  username: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || username.slice(0, 1).toUpperCase();
  const hue = [...username].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 360;
  return (
    <span
      className={`avatar avatar--${size}`}
      style={{ '--avatar-hue': hue } as React.CSSProperties}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}
