// src/components/ConnectPhoneModal.tsx

import { useState, useEffect, useMemo, useRef, useCallback, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useFocusRestore } from '../lib/focus-restore';
import { useStore, getStore } from '../store/store';
import { startRemoteAccess, stopRemoteAccess, refreshRemoteStatus } from '../store/store';
import { theme } from '../lib/theme';

type NetworkMode = 'wifi' | 'tailscale';

interface ConnectPhoneModalProps {
  open: boolean;
  onClose: () => void;
}

export function ConnectPhoneModal({ open, onClose }: ConnectPhoneModalProps): ReactNode {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [mode, setMode] = useState<NetworkMode>('wifi');
  const dialogRef = useRef<HTMLDivElement>(null);
  const stopPollingRef = useRef<(() => void) | undefined>(undefined);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const startingRef = useRef(false);

  // Keep refs in sync with props/state so we can read them without re-triggering effects
  startingRef.current = starting;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const remoteAccess = useStore((s) => s.remoteAccess);

  const activeUrl = useMemo(() => {
    if (!remoteAccess.enabled) return null;
    return mode === 'tailscale' ? remoteAccess.tailscaleUrl : remoteAccess.wifiUrl;
  }, [mode, remoteAccess.enabled, remoteAccess.tailscaleUrl, remoteAccess.wifiUrl]);

  useFocusRestore(open);

  // Cleanup copied timer on unmount
  useEffect(() => {
    return () => {
      if (copiedTimerRef.current !== undefined) clearTimeout(copiedTimerRef.current);
    };
  }, []);

  const generateQr = useCallback(async (url: string) => {
    try {
      const QRCode = await import('qrcode');
      const dataUrl = await QRCode.toDataURL(url, {
        width: 256,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' },
      });
      setQrDataUrl(dataUrl);
    } catch {
      setQrDataUrl(null);
    }
  }, []);

  // Regenerate QR when mode changes
  useEffect(() => {
    if (activeUrl) {
      setQrDataUrl(null); // clear stale QR immediately
      generateQr(activeUrl);
    }
  }, [activeUrl, generateQr]);

  // Start server when modal opens
  useEffect(() => {
    if (!open) return;

    requestAnimationFrame(() => dialogRef.current?.focus());

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', handler);

    const store = getStore();
    if (!store.remoteAccess.enabled && !startingRef.current) {
      setStarting(true);
      setError(null);
      startRemoteAccess()
        .then((result) => {
          setStarting(false);
          // Default to wifi if available, otherwise tailscale
          setMode(result.wifiUrl ? 'wifi' : 'tailscale');
          const url = result.wifiUrl ?? result.tailscaleUrl ?? result.url;
          generateQr(url);
        })
        .catch((err: unknown) => {
          setStarting(false);
          setError(err instanceof Error ? err.message : String(err));
        });
    } else {
      // Re-derive mode if network changed since last open
      setMode((prev) => {
        if (prev === 'wifi' && !store.remoteAccess.wifiUrl && store.remoteAccess.tailscaleUrl) {
          return 'tailscale';
        }
        if (prev === 'tailscale' && !store.remoteAccess.tailscaleUrl && store.remoteAccess.wifiUrl) {
          return 'wifi';
        }
        return prev;
      });
      // QR regeneration is handled by the activeUrl effect above
    }

    // Poll connected clients count while modal is open
    let pollActive = true;
    const interval = setInterval(() => {
      if (pollActive) refreshRemoteStatus();
    }, 3000);
    stopPollingRef.current = () => {
      pollActive = false;
      clearInterval(interval);
    };

    return () => {
      document.removeEventListener('keydown', handler);
      stopPollingRef.current?.();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- onClose accessed via ref to avoid re-running effect
  }, [open, generateQr]);

  async function handleDisconnect() {
    stopPollingRef.current?.();
    await stopRemoteAccess();
    setQrDataUrl(null);
    onClose();
  }

  async function handleCopyUrl() {
    if (!activeUrl) return;
    try {
      await navigator.clipboard.writeText(activeUrl);
      setCopied(true);
      if (copiedTimerRef.current !== undefined) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard not available */
    }
  }

  const pillStyle = (active: boolean): CSSProperties => ({
    padding: '6px 14px',
    borderRadius: '6px',
    border: 'none',
    fontSize: '12px',
    cursor: 'pointer',
    background: active ? theme.accent : 'transparent',
    color: active ? '#fff' : theme.fgMuted,
    fontWeight: active ? '600' : '400',
  });

  return createPortal(
    open ? (
      <div
        style={{
          position: 'fixed',
          inset: '0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(0,0,0,0.55)',
          zIndex: 1000,
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div
          ref={dialogRef}
          tabIndex={0}
          style={{
            background: theme.islandBg,
            border: `1px solid ${theme.border}`,
            borderRadius: '14px',
            padding: '28px',
            width: '380px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '20px',
            outline: 'none',
            boxShadow: '0 12px 48px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.03) inset',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ textAlign: 'center' }}>
            <h2
              style={{ margin: '0', fontSize: '16px', color: theme.fg, fontWeight: '600' }}
            >
              Connect Phone
            </h2>
            <span style={{ fontSize: '11px', color: theme.fgSubtle }}>Experimental</span>
          </div>

          {starting && (
            <div style={{ color: theme.fgMuted, fontSize: '13px' }}>Starting server...</div>
          )}

          {error && (
            <div style={{ color: theme.error, fontSize: '13px', textAlign: 'center' }}>
              {error}
            </div>
          )}

          {!starting && remoteAccess.enabled && (
            <>
              {/* Network mode toggle */}
              <div
                style={{
                  display: 'flex',
                  gap: '4px',
                  background: theme.bgInput,
                  borderRadius: '8px',
                  padding: '3px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '2px',
                  }}
                >
                  <button
                    onClick={() => setMode('wifi')}
                    disabled={!remoteAccess.wifiUrl}
                    style={{
                      ...pillStyle(mode === 'wifi' && !!remoteAccess.wifiUrl),
                      ...(!remoteAccess.wifiUrl
                        ? { opacity: '0.35', cursor: 'default' }
                        : {}),
                    }}
                  >
                    WiFi
                  </button>
                  {!remoteAccess.wifiUrl && (
                    <span style={{ fontSize: '9px', color: theme.fgSubtle }}>Not detected</span>
                  )}
                </div>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '2px',
                  }}
                >
                  <button
                    onClick={() => setMode('tailscale')}
                    disabled={!remoteAccess.tailscaleUrl}
                    style={{
                      ...pillStyle(mode === 'tailscale' && !!remoteAccess.tailscaleUrl),
                      ...(!remoteAccess.tailscaleUrl
                        ? { opacity: '0.35', cursor: 'default' }
                        : {}),
                    }}
                  >
                    Tailscale
                  </button>
                  {!remoteAccess.tailscaleUrl && (
                    <span style={{ fontSize: '9px', color: theme.fgSubtle }}>Not detected</span>
                  )}
                </div>
              </div>

              {/* QR Code */}
              {qrDataUrl && (
                <img
                  src={qrDataUrl}
                  alt="Connection QR code"
                  style={{ width: '200px', height: '200px', borderRadius: '8px' }}
                />
              )}

              {/* URL */}
              <div
                style={{
                  width: '100%',
                  background: theme.bgInput,
                  border: `1px solid ${theme.border}`,
                  borderRadius: '8px',
                  padding: '10px 12px',
                  fontSize: '12px',
                  fontFamily: "'JetBrains Mono', monospace",
                  color: theme.fg,
                  wordBreak: 'break-all',
                  textAlign: 'center',
                  cursor: 'pointer',
                }}
                onClick={handleCopyUrl}
                title="Click to copy"
              >
                {activeUrl ?? remoteAccess.url}
              </div>

              {copied && (
                <span style={{ fontSize: '12px', color: theme.success }}>Copied!</span>
              )}

              {/* Instructions */}
              <p
                style={{
                  fontSize: '12px',
                  color: theme.fgMuted,
                  textAlign: 'center',
                  margin: '0',
                  lineHeight: '1.5',
                }}
              >
                Scan the QR code or copy the URL to monitor and interact with your agent terminals
                from your phone.
                {mode === 'tailscale'
                  ? <> Your phone and this computer must be on the same Tailscale network.</>
                  : <> Your phone and this computer must be on the same WiFi network.</>
                }
              </p>

              {/* Connected clients */}
              {remoteAccess.connectedClients > 0 ? (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                >
                  <svg
                    width="48"
                    height="48"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke={theme.success}
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                  <span style={{ fontSize: '14px', color: theme.success, fontWeight: '500' }}>
                    {remoteAccess.connectedClients} client(s) connected
                  </span>
                </div>
              ) : (
                <div
                  style={{
                    fontSize: '12px',
                    color: theme.fgSubtle,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <div
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: theme.fgSubtle,
                    }}
                  />
                  Waiting for connection...
                </div>
              )}

              {/* Disconnect — always available when server is running */}
              <button
                onClick={handleDisconnect}
                style={{
                  padding: '7px 16px',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: '8px',
                  color: theme.fgSubtle,
                  cursor: 'pointer',
                  fontSize: '12px',
                  fontWeight: '400',
                }}
              >
                Disconnect
              </button>
            </>
          )}
        </div>
      </div>
    ) : null,
    document.body,
  );
}
