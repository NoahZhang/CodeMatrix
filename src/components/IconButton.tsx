import type { ReactNode } from 'react';
import { theme } from '../lib/theme';

interface IconButtonProps {
  icon: ReactNode;
  onClick: (e: React.MouseEvent) => void;
  title?: string;
  size?: 'sm' | 'md';
}

export function IconButton({ icon, onClick, title, size }: IconButtonProps) {
  const isSm = size === 'sm';

  return (
    <button
      className="icon-btn"
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      style={{
        background: 'transparent',
        border: `1px solid ${theme.border}`,
        color: theme.fgMuted,
        cursor: 'pointer',
        borderRadius: '6px',
        padding: isSm ? '2px' : '4px',
        fontSize: isSm ? '11px' : '13px',
        lineHeight: 1,
        flexShrink: 0,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {icon}
    </button>
  );
}
