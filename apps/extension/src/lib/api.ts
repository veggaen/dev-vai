/**
 * Communication with the VAI runtime server.
 */

const VAI_SERVER = 'http://localhost:3006';

export interface CapturePayload {
  type: string;
  url: string;
  title: string;
  content: string;
  language?: string;
  meta?: Record<string, unknown>;
}

export async function sendCapture(payload: CapturePayload): Promise<{ sourceId: string } | null> {
  try {
    const res = await fetch(`${VAI_SERVER}/api/capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    console.warn('[VAI] Server not reachable at', VAI_SERVER);
    return null;
  }
}

export async function getServerHealth(): Promise<{ status: string; stats: Record<string, number> } | null> {
  try {
    const res = await fetch(`${VAI_SERVER}/health`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
