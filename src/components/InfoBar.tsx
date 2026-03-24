import type { ReactNode } from 'react';
import { theme } from '../lib/theme';
import { sf } from '../lib/fontScale';

interface InfoBarProps {
  children: ReactNode;
  onClick?: (e?: React.MouseEvent) => void;
  onDblClick?: () => void;
  title?: string;
  className?: string;
}

export function InfoBar({ children, onClick, onDblClick, title, className }: InfoBarProps) {
  return (
    <div
      className={className}
      title={title}
      onClick={(e) => onClick?.(e)}
      onDoubleClick={() => onDblClick?.()}
      style={{
        height: '28px',
        minHeight: '28px',
        display: 'flex',
        alignItems: 'center',
        padding: '0 10px',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: sf(11),
        color: theme.fgMuted,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        cursor: onClick ? 'pointer' : 'default',
        userSelect: 'none',
      }}
    >
      {children}
    </div>
  );
}
