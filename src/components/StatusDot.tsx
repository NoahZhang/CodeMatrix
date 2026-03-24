import type { TaskDotStatus } from '../store/store';
import { theme } from '../lib/theme';

const SIZES = { sm: 6, md: 8 } as const;

function getDotColor(status: TaskDotStatus): string {
  return { busy: theme.fgMuted, waiting: '#e5a800', ready: theme.success }[status];
}

export function StatusDot({ status, size = 'sm' }: { status: TaskDotStatus; size?: 'sm' | 'md' }) {
  const px = SIZES[size];
  return (
    <span
      className={status === 'busy' ? 'status-dot-pulse' : undefined}
      style={{
        display: 'inline-block',
        width: `${px}px`,
        height: `${px}px`,
        borderRadius: '50%',
        background: getDotColor(status),
        flexShrink: '0',
      }}
    />
  );
}
