import { useEffect, useRef, type ReactNode, type CSSProperties } from 'react';
import { getFontScale, adjustFontScale } from '../store/store';
import { createCtrlWheelZoomHandler } from '../lib/wheelZoom';

interface ScalablePanelProps {
  panelId: string;
  children: ReactNode;
  style?: CSSProperties;
}

export function ScalablePanel({ panelId, children, style }: ScalablePanelProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const handleWheel = createCtrlWheelZoomHandler(
      (delta) => adjustFontScale(panelId, delta),
      { stopPropagation: true },
    );

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', handleWheel);
    };
  }, [panelId]);

  return (
    <div
      ref={ref}
      style={{
        '--font-scale': String(getFontScale(panelId)),
        width: '100%',
        height: '100%',
        ...style,
      } as CSSProperties}
    >
      {children}
    </div>
  );
}
