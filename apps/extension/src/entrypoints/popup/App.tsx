import { useState, useEffect } from 'react';

interface ServerStatus {
  connected: boolean;
  stats?: {
    vocabSize: number;
    knowledgeEntries: number;
    ngramContexts: number;
    documentsIndexed: number;
  };
}

export function App() {
  const [status, setStatus] = useState<ServerStatus>({ connected: false });
  const [captureCount, setCaptureCount] = useState(0);
  const [message, setMessage] = useState('');

  useEffect(() => {
    // Check server connection
    browser.runtime.sendMessage({ type: 'GET_STATUS' }).then((res) => {
      if (res?.connected) {
        setStatus({ connected: true, stats: res.data?.stats });
      }
    });

    // Get capture count
    browser.storage.local.get('captureCount').then((data) => {
      setCaptureCount((data.captureCount as number) ?? 0);
    });
  }, []);

  const captureCurrentPage = async () => {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    setMessage('Capturing...');
    try {
      const [result] = await browser.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => ({
          title: document.title,
          content: document.body.innerText.slice(0, 50000),
          url: window.location.href,
        }),
      });

      if (result?.result) {
        const res = await browser.runtime.sendMessage({
          type: 'SAVE_CONTENT',
          ...result.result,
        });

        if (res?.success) {
          setMessage('Captured!');
          setCaptureCount((c) => c + 1);
        } else {
          setMessage(res?.error ?? 'Failed');
        }
      }
    } catch (_err) {
      setMessage('Error capturing page');
    }

    setTimeout(() => setMessage(''), 2000);
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
                <div>Vocab: {status.stats.vocabSize} tokens</div>
                <div>Knowledge: {status.stats.knowledgeEntries} entries</div>
                <div>Documents: {status.stats.documentsIndexed} indexed</div>
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
        Privacy: login pages, banking, and passwords are never captured.
      </div>
    </div>
  );
}
