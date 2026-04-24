import { useState, useEffect } from 'react';
import { getCapturePolicy, hostnameFromUrl, isSensitivePage, type CapturePolicy, type DomainCapturePolicyMap } from '../../lib/privacy.js';

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

interface CaptureLogEntry {
  id: string;
  at: string;
  title: string;
  url: string;
  hostname: string;
  method: string;
  policy: CapturePolicy;
  updated: boolean;
  reason: string;
}

export function App() {
  const [status, setStatus] = useState<ServerStatus>({ connected: false });
  const [captureCount, setCaptureCount] = useState(0);
  const [message, setMessage] = useState('');
  const [autoCapture, setAutoCapture] = useState(false);
  const [privacyConfirmed, setPrivacyConfirmed] = useState(false);
  const [activeUrl, setActiveUrl] = useState<string | null>(null);
  const [activeHostname, setActiveHostname] = useState<string | null>(null);
  const [activePolicy, setActivePolicy] = useState<CapturePolicy>('always');
  const [captureLog, setCaptureLog] = useState<CaptureLogEntry[]>([]);

  useEffect(() => {
    // Check server connection
    browser.runtime.sendMessage({ type: 'GET_STATUS' }).then((res) => {
      if (res?.connected) {
        setStatus({ connected: true, stats: res.data?.stats });
      }
    });

    // Get capture count, privacy state, current policies, and capture log
    browser.storage.local.get([
      'captureCount',
      'autoCapture',
      'privacyConfirmed',
      'domainCapturePolicies',
      'captureLog',
    ]).then(async (data) => {
      setCaptureCount((data.captureCount as number) ?? 0);
      setAutoCapture((data.autoCapture as boolean) ?? false);
      setPrivacyConfirmed((data.privacyConfirmed as boolean) ?? false);
      setCaptureLog(Array.isArray(data.captureLog) ? data.captureLog as CaptureLogEntry[] : []);

      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.url) return;
      setActiveUrl(tab.url);
      const hostname = hostnameFromUrl(tab.url);
      setActiveHostname(hostname);
      const rules = (data.domainCapturePolicies as DomainCapturePolicyMap | undefined) ?? {};
      setActivePolicy(getCapturePolicy(tab.url, rules));
    });
  }, []);

  const acknowledgePrivacy = async () => {
    setPrivacyConfirmed(true);
    await browser.storage.local.set({ privacyConfirmed: true });
    setMessage('Privacy rules acknowledged');
    setTimeout(() => setMessage(''), 2000);
  };

  const toggleAutoCapture = async () => {
    if (!privacyConfirmed) {
      setMessage('Review the privacy rules before enabling auto-capture');
      setTimeout(() => setMessage(''), 2500);
      return;
    }
    const newValue = !autoCapture;
    setAutoCapture(newValue);
    await browser.storage.local.set({ autoCapture: newValue });
    // Notify background script so it can act on tab updates
    browser.runtime.sendMessage({ type: 'SET_AUTO_CAPTURE', enabled: newValue });
  };

  const updateDomainPolicy = async (policy: CapturePolicy) => {
    if (!activeHostname || !activeUrl) return;
    const data = await browser.storage.local.get('domainCapturePolicies');
    const rules = ((data.domainCapturePolicies as DomainCapturePolicyMap | undefined) ?? {});
    const nextRules: DomainCapturePolicyMap = { ...rules, [activeHostname]: policy };
    await browser.storage.local.set({ domainCapturePolicies: nextRules });
    setActivePolicy(getCapturePolicy(activeUrl, nextRules));
    setMessage(`Capture policy for ${activeHostname} set to ${policy}`);
    setTimeout(() => setMessage(''), 2500);
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

      {!privacyConfirmed && (
        <div style={{
          marginBottom: '12px',
          padding: '10px',
          background: '#18181b',
          border: '1px solid #3f3f46',
          borderRadius: '8px',
        }}>
          <div style={{ fontSize: '12px', color: '#f4f4f5', fontWeight: '600', marginBottom: '4px' }}>
            Review privacy rules before enabling auto-capture
          </div>
          <div style={{ fontSize: '11px', color: '#a1a1aa', marginBottom: '8px', lineHeight: 1.4 }}>
            Sensitive pages default to <strong>never</strong>. You can set each site to <strong>always</strong>, <strong>ask</strong>, or <strong>never</strong>.
          </div>
          <button
            onClick={acknowledgePrivacy}
            style={{
              width: '100%',
              padding: '7px 10px',
              background: '#27272a',
              color: '#fafafa',
              border: '1px solid #3f3f46',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: '600',
            }}
          >
            I understand the capture rules
          </button>
        </div>
      )}

      {activeHostname && (
        <div style={{
          marginBottom: '12px',
          padding: '10px',
          background: '#18181b',
          borderRadius: '8px',
          border: '1px solid #27272a',
        }}>
          <div style={{ fontSize: '12px', color: '#d4d4d8', fontWeight: '600', marginBottom: '4px' }}>
            Current site
          </div>
          <div style={{ fontSize: '11px', color: '#71717a', marginBottom: '8px' }}>{activeHostname}</div>
          <label style={{ fontSize: '11px', color: '#a1a1aa', display: 'block', marginBottom: '4px' }}>
            Capture policy
          </label>
          <select
            value={activePolicy}
            onChange={(event) => { void updateDomainPolicy(event.target.value as CapturePolicy); }}
            disabled={activeUrl ? isSensitivePage(activeUrl) : false}
            style={{
              width: '100%',
              padding: '7px 8px',
              background: '#0f0f10',
              color: '#f4f4f5',
              border: '1px solid #3f3f46',
              borderRadius: '6px',
              fontSize: '12px',
              opacity: activeUrl && isSensitivePage(activeUrl) ? 0.65 : 1,
            }}
          >
            <option value="always">Always capture</option>
            <option value="ask">Ask / manual only</option>
            <option value="never">Never capture</option>
          </select>
          <div style={{ fontSize: '10px', color: '#71717a', marginTop: '6px', lineHeight: 1.4 }}>
            {activeUrl && isSensitivePage(activeUrl)
              ? 'Sensitive pages stay blocked even if a policy was previously saved.'
              : '“Ask” means auto-capture skips this domain, but you can still capture manually.'}
          </div>
        </div>
      )}

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
            cursor: privacyConfirmed ? 'pointer' : 'not-allowed',
            opacity: privacyConfirmed ? 1 : 0.55,
            position: 'relative', transition: 'background 0.2s',
          }}
          title={privacyConfirmed ? 'Toggle auto-capture' : 'Acknowledge privacy rules first'}
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

      {captureLog.length > 0 && (
        <div style={{
          marginTop: '14px',
          padding: '10px',
          background: '#18181b',
          borderRadius: '8px',
          border: '1px solid #27272a',
        }}>
          <div style={{ fontSize: '12px', color: '#d4d4d8', fontWeight: '600', marginBottom: '6px' }}>
            Recent captures
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {captureLog.slice(0, 5).map((entry) => (
              <div key={entry.id} style={{ borderTop: '1px solid #27272a', paddingTop: '8px' }}>
                <div style={{ fontSize: '11px', color: '#f4f4f5', fontWeight: '500' }}>
                  {entry.updated ? 'Updated' : 'Saved'}: {entry.title}
                </div>
                <div style={{ fontSize: '10px', color: '#71717a', lineHeight: 1.4 }}>
                  {entry.hostname} · {entry.method} · policy {entry.policy} · {new Date(entry.at).toLocaleTimeString()}
                </div>
                <div style={{ fontSize: '10px', color: '#52525b', lineHeight: 1.4 }}>
                  {entry.reason}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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
        {' '}Privacy: login pages, banking, and obvious secrets are blocked or redacted before capture.
        <div style={{ marginTop: '6px' }}>
          Next step: capture a page here, then ask the desktop app what you read and why it mattered.
        </div>
      </div>
    </div>
  );
}
