import type { ReactNode } from 'react';

interface Props {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  icon?: string;
}

export function EmptyState({ title, children, action, icon = '📚' }: Props) {
  return (
    <section className="empty card" aria-label={title}>
      <span className="empty__icon" aria-hidden="true">
        {icon}
      </span>
      <h2 className="empty__title">{title}</h2>
      {children && <div className="muted">{children}</div>}
      {action}
    </section>
  );
}
