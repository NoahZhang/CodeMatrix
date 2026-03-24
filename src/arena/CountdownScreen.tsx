import { useState, useEffect, useRef } from 'react';
import { setPhase } from './store';

export function CountdownScreen() {
  const [count, setCount] = useState(3);
  const textRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let current = 3;
    const interval = setInterval(() => {
      current--;
      if (current >= 0) {
        setCount(current);
      } else {
        clearInterval(interval);
        setPhase('battle');
      }
    }, 800);
    return () => clearInterval(interval);
  }, []);

  // Re-trigger the pulse animation each time count changes
  useEffect(() => {
    if (textRef.current) {
      textRef.current.style.animation = 'none';
      void textRef.current.offsetHeight; // force reflow
      textRef.current.style.animation = '';
    }
  }, [count]);

  return (
    <div className="arena-countdown">
      <div
        ref={textRef}
        className={`arena-countdown-text${count === 0 ? ' arena-countdown-go' : ''}`}
      >
        {count > 0 ? count : 'GO!'}
      </div>
    </div>
  );
}
