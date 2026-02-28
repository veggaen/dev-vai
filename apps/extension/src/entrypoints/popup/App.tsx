import { useState, useEffect } from 'react';

interface ServerStatus {
  connected: boolean;
  stats?: {
    vocabSize: number;
    knowledgeEntries: number;
    ngramContexts: number;
    documentsIndexed: number;
    conceptsExtracted?: number;
  };
}

export function App() {
  const [status, setStatus] = useState<ServerStatus>({ connected: false });
  const [captureCount, setCaptureCount] = useState(0);
  const [message, setMessage] = useState('');
  const [autoCapture, setAutoCapture] = useState(false);

  useEffect(() => {
    // Check server connection
    browser.runtime.sendMessage({ type: 'GET_STATUS' }).then((res) => {
      if (res?.connected) {
        setStatus({ connected: true, stats: res.data?.stats });
      }
    });

    // Get capture count and auto-capture setting
    browser.storage.local.get(['captureCount', 'autoCapture']).then((data) => {
      setCaptureCount((data.captureCount as number) ?? 0);
      setAutoCapture((data.autoCapture as boolean) ?? false);
    });
  }, []);

  const toggleAutoCapture = async () => {
    const newValue = !autoCapture;
    setAutoCapture(newValue);
    await browser.storage.local.set({ autoCapture: newValue });
    // Notify background script so it can act on tab updates
    browser.runtime.sendMessage({ type: 'SET_AUTO_CAPTURE', enabled: newValue });
  };

  const captureCurrentPage = async () => {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url) return;

    const url = tab.url;
    if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') ||
        url.startsWith('edge://') || url.startsWith('about:') || url.startsWith('devtools://')) {
      setMessage('Cannot capture browser pages');
      setTimeout(() => setMessage(''), 2000);
      return;
    }

    setMessage('Capturing...');
    try {
      const res = await browser.runtime.sendMessage({
        type: 'CAPTURE_PAGE',
        tabId: tab.id,
        url: tab.url,
        title: tab.title ?? '',
      });

      if (res?.success) {
        const updated = res.result?.updated;
        setMessage(updated ? 'Updated!' : 'Captured!');
        if (!updated) setCaptureCount((c) => c + 1);
      } else {
        setMessage(res?.error ?? 'Failed to capture');
      }
    } catch (_err) {
      setMessage('Capture failed');
    }

    setTimeout(() => setMessage(''), 3000);
  };

  return (
    <div style={{ padding: '16px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
        <div style={{ fontSize: '18px', fontWeight: 'bold' }}>VeggaAI</div>
        <div style={{
          width: '8px', height: '8px', borderRadius: '50%',
          background: status.connected ? '#22c55e' : '#ef4444',
        }} />
      </div>

      {/* Status */}
      <div style={{ fontSize: '12px', color: '#a1a1aa', marginBottom: '12px' }}>
        {status.connected ? (
          <>
            <div>Server: Connected</div>
            {status.stats && (
              <>
                <div>Vocab: {status.stats.vocabSize.toLocaleString()} tokens</div>
                <div>Knowledge: {status.stats.knowledgeEntries} entries</div>
                <div>Documents: {status.stats.documentsIndexed} indexed</div>
                {status.stats.conceptsExtracted != null && status.stats.conceptsExtracted > 0 && (
                  <div>Concepts: {status.stats.conceptsExtracted.toLocaleString()} extracted</div>
                )}
              </>
            )}
          </>
        ) : (
          <div style={{ color: '#ef4444' }}>
            Server offline. Start VAI: <code style={{ background: '#27272a', padding: '2px 4px', borderRadius: '3px' }}>pnpm dev:web</code>
          </div>
        )}
      </div>

      {/* Capture count */}
      <div style={{ fontSize: '13px', marginBottom: '12px', color: '#d4d4d8' }}>
        Pages captured: <strong>{captureCount}</strong>
      </div>

      {/* Auto-capture toggle */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: '12px', padding: '8px 10px',
        background: '#18181b', borderRadius: '6px', border: '1px solid #27272a',
      }}>
        <div>
          <div style={{ fontSize: '13px', color: '#d4d4d8', fontWeight: '500' }}>Auto-capture</div>
          <div style={{ fontSize: '11px', color: '#71717a' }}>Learn from pages you visit</div>
        </div>
        <button
          onClick={toggleAutoCapture}
          style={{
            width: '40px', height: '22px', borderRadius: '11px', border: 'none',
            background: autoCapture ? '#2563eb' : '#3f3f46',
            cursor: 'pointer', position: 'relative', transition: 'background 0.2s',
          }}
        >
          <div style={{
            width: '16px', height: '16px', borderRadius: '50%', background: 'white',
            position: 'absolute', top: '3px',
            left: autoCapture ? '21px' : '3px',
            transition: 'left 0.2s',
          }} />
        </button>
      </div>

      {/* Manual capture button */}
      <button
        onClick={captureCurrentPage}
        disabled={!status.connected}
        style={{
          width: '100%', padding: '8px 12px',
          background: status.connected ? '#2563eb' : '#3f3f46',
          color: 'white', border: 'none', borderRadius: '6px',
          cursor: status.connected ? 'pointer' : 'not-allowed',
          fontSize: '13px', fontWeight: '500',
        }}
      >
        Capture This Page
      </button>

      {/* Message */}
      {message && (
        <div style={{ marginTop: '8px', fontSize: '12px', color: '#a1a1aa', textAlign: 'center' }}>
          {message}
        </div>
      )}

      {/* Info */}
      <div style={{ marginTop: '16px', fontSize: '11px', color: '#71717a', borderTop: '1px solid #27272a', paddingTop: '12px' }}>
        VAI auto-captures: YouTube transcripts, GitHub repos, Google searches.
        {autoCapture && ' + all web pages you visit.'}
        {' '}Privacy: login pages, banking, and passwords are never captured.
      </div>
    </div>
  );
}
