import { type HTMLAttributes, type ReactNode, useRef, useEffect } from 'react';

interface ScrollAreaProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  autoScroll?: boolean;
}

export function ScrollArea({
  children,
  autoScroll = false,
  className = '',
  ...props
}: ScrollAreaProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoScroll && ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  });

  return (
    <div
      ref={ref}
      className={`overflow-y-auto ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
