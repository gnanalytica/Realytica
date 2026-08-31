import { useEffect, useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { cn } from '../../components/ui/kit';

export function useLiveHighlight<T extends HTMLElement = HTMLDivElement>(id: string, highlightIds?: string[]) {
  const ref = useRef<T | null>(null);
  const on = Boolean(highlightIds?.includes(id));
  useEffect(() => {
    if (on) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [on, id]);
  return { ref, on };
}

export function LiveRow({
  id,
  highlightIds,
  children,
  className,
  variant = 'card',
  style,
}: {
  id: string;
  highlightIds?: string[];
  children: ReactNode;
  className?: string;
  variant?: 'card' | 'flush';
  style?: CSSProperties;
}) {
  const { ref, on } = useLiveHighlight(id, highlightIds);
  return (
    <div
      ref={ref}
      data-live={on ? 'true' : undefined}
      style={style}
      className={cn(
        variant === 'card' && 'rounded-lg border p-3',
        variant === 'card' && (on ? 'border-brand bg-brand-soft ring-2 ring-brand/35' : 'border-hairline'),
        variant === 'flush' && 'scroll-mt-2',
        variant === 'flush' && on && 'bg-brand-soft ring-2 ring-inset ring-brand/35',
        className,
      )}
    >
      {children}
    </div>
  );
}
