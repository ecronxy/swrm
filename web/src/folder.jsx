// Folder from sdkhub.org/components (the collection covers): back plate and the
// front flap that tips open. Paths, gradients and springs are theirs.
import { useId } from 'react';
import { cn } from './ui.jsx';

const SPRING = 'cubic-bezier(0.34, 1.56, 0.64, 1)';

export function Folder({ size = 150, open = false, className }) {
  const id = useId().replace(/:/g, '');
  const k = size / 150;
  return (
    <span
      aria-hidden="true"
      data-open={open || undefined}
      className={cn('block shrink-0', className)}
      style={{
        filter: `drop-shadow(rgba(30, 110, 170, 0.22) 0px ${8 * k}px ${8 * k}px)`,
        transition: `transform 0.5s ${SPRING}`,
        transform: open ? 'translateY(2px) scale(1.04)' : undefined,
      }}
    >
      <span className="relative block" style={{ width: size, height: size * 0.8, perspective: 520 }}>
        <svg className="absolute inset-0 size-full" viewBox="0 0 120 96">
          <defs>
            <linearGradient id={`${id}b`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#6cc3f0" />
              <stop offset="1" stopColor="#4fb1e4" />
            </linearGradient>
          </defs>
          <path d="M0 11a9 9 0 0 1 9-9h26.5a9 9 0 0 1 7.2 3.6l3.6 4.8a6 6 0 0 0 4.8 2.4H111a9 9 0 0 1 9 9v60a9 9 0 0 1-9 9H9a9 9 0 0 1-9-9V11Z" fill={`url(#${id}b)`} />
        </svg>
        <span className="absolute inset-0 z-[2]" style={{ transformOrigin: '50% 100%', transition: `transform 0.5s ${SPRING}`, transform: open ? 'rotateX(-34deg)' : undefined }}>
          <svg className="absolute inset-0 size-full" viewBox="0 0 120 96">
            <defs>
              <linearGradient id={`${id}f`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#76d3fc" />
                <stop offset="0.5" stopColor="#5cc0ee" />
                <stop offset="1" stopColor="#46afe2" />
              </linearGradient>
            </defs>
            <path d="M0 33a9 9 0 0 1 9-9h102a9 9 0 0 1 9 9v54a9 9 0 0 1-9 9H9a9 9 0 0 1-9-9V33Z" fill={`url(#${id}f)`} />
            <path d="M9.5 24.5h101a8.5 8.5 0 0 1 8.4 7.3c-.4-.5-1.2-.8-2-.8H3.1c-.8 0-1.6.3-2 .8a8.5 8.5 0 0 1 8.4-7.3Z" fill="#fff" opacity=".28" />
          </svg>
        </span>
      </span>
    </span>
  );
}
