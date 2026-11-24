interface Props {
  /** Announced to screen readers and shown next to the spinner unless `inline`. */
  label: string;
  /** Small, label visually hidden (e.g. inside a button). */
  inline?: boolean;
}

export function Spinner({ label, inline = false }: Props) {
  return (
    <span className={inline ? 'spinner spinner--inline' : 'spinner'} role="status">
      <span className="spinner__circle" aria-hidden="true" />
      <span className={inline ? 'visually-hidden' : 'spinner__label'}>{label}</span>
    </span>
  );
}
