// This file is deprecated — use store.ts instead.
// Re-exports for backward compatibility during migration.
export { useStore, getStore, setStore, cleanupPanelEntries, updateWindowTitle } from './store';

// Legacy alias: `store` was the reactive SolidJS store object.
// In React/Zustand, use `getStore()` for imperative access or `useStore()` hook in components.
export { getStore as store } from './store';
