import { useState } from 'react';
import { pushTask } from '../store/store';
import { ConfirmDialog } from './ConfirmDialog';
import { theme } from '../lib/theme';
import type { Task } from '../store/types';

interface PushDialogProps {
  open: boolean;
  task: Task;
  onStart: () => void;
  onDone: (success: boolean) => void;
}

export function PushDialog({ open, task, onStart, onDone }: PushDialogProps) {
  const [pushError, setPushError] = useState('');
  const [pushing, setPushing] = useState(false);

  return (
    <ConfirmDialog
      open={open}
      title="Push to Remote"
      message={
        <div>
          <p style={{ margin: '0 0 8px' }}>
            Push branch <strong>{task.branchName}</strong> to remote?
          </p>
          {pushError && (
            <div
              style={{
                marginTop: '12px',
                fontSize: '12px',
                color: theme.error,
                background: `color-mix(in srgb, ${theme.error} 8%, transparent)`,
                padding: '8px 12px',
                borderRadius: '8px',
                border: `1px solid color-mix(in srgb, ${theme.error} 20%, transparent)`,
              }}
            >
              {pushError}
            </div>
          )}
        </div>
      }
      confirmLabel={pushing ? 'Pushing...' : 'Push'}
      onConfirm={() => {
        const taskId = task.id;
        setPushError('');
        setPushing(true);
        onStart();
        void pushTask(taskId)
          .then(() => {
            onDone(true);
          })
          .catch((err) => {
            setPushError(String(err));
            onDone(false);
          })
          .finally(() => {
            setPushing(false);
          });
      }}
      onCancel={() => {
        onDone(false);
        setPushError('');
      }}
    />
  );
}
