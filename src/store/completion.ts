import { getLocalDateKey } from '../lib/date';
import { getStore, setStore } from './store';

export function recordTaskCompleted(): void {
  const today = getLocalDateKey();
  setStore((s) => {
    if (s.completedTaskDate !== today) {
      s.completedTaskDate = today;
      s.completedTaskCount = 1;
      return;
    }
    s.completedTaskCount += 1;
  });
}

export function getCompletedTasksTodayCount(): number {
  const s = getStore();
  return s.completedTaskDate === getLocalDateKey() ? s.completedTaskCount : 0;
}

export function recordMergedLines(linesAdded: number, linesRemoved: number): void {
  const safeAdded = Number.isFinite(linesAdded) ? Math.max(0, Math.floor(linesAdded)) : 0;
  const safeRemoved = Number.isFinite(linesRemoved) ? Math.max(0, Math.floor(linesRemoved)) : 0;
  if (safeAdded === 0 && safeRemoved === 0) return;

  setStore((s) => {
    s.mergedLinesAdded += safeAdded;
    s.mergedLinesRemoved += safeRemoved;
  });
}

export function getMergedLineTotals(): { added: number; removed: number } {
  const s = getStore();
  return {
    added: s.mergedLinesAdded,
    removed: s.mergedLinesRemoved,
  };
}
