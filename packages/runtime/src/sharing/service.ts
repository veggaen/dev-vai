import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { resolveCname, resolveTxt } from 'node:dns/promises';
import {
  customDomainResultSchema,
  shareManifestSchema,
  sharePublishReceiptSchema,
  type ShareManifest,
} from '@vai/contracts/adoption';
import { JsonStore } from '../persistence/json-store.js';
import { LIMITS } from '@vai/constants';

export class ShareService {
  private manifests: ShareManifest[];
  constructor(private readonly store: JsonStore<ShareManifest[]>, private readonly now = () => Date.now()) {
    this.manifests = store.read().flatMap((value) => { const parsed = shareManifestSchema.safeParse(value); return parsed.success ? [parsed.data] : []; });
  }
  list(): ShareManifest[] { return [...this.manifests]; }
  restore(records: readonly ShareManifest[], overwrite: boolean): number {
    const existing = new Set(this.manifests.map((record) => record.id));
    const accepted = records.map((record) => shareManifestSchema.parse(record)).filter((record) => overwrite || !existing.has(record.id));
    if (overwrite) {
      const ids = new Set(accepted.map((record) => record.id));
      this.manifests = this.manifests.filter((record) => !ids.has(record.id));
    }
    this.manifests.push(...accepted); this.store.write(this.manifests); return accepted.length;
  }
  publish(input: { workspaceId: string; items: Array<Omit<ShareManifest['items'][number], 'checksum'>> }, permalinkBase: string) {
    const current = this.manifests.find((manifest) => manifest.workspaceId === input.workspaceId);
    const oldByObject = new Map(current?.items.map((item) => [item.objectId, item]) ?? []);
    const now = this.now();
    const items = input.items.map((item) => {
      if ((item.content?.length ?? 0) > LIMITS.shareSnapshotCharacters) {
        throw new Error(`Share snapshot exceeds ${LIMITS.shareSnapshotCharacters} characters: ${item.path}`);
      }
      if ((item.themeCss?.length ?? 0) > LIMITS.shareThemeCssCharacters) {
        throw new Error(`Share theme exceeds ${LIMITS.shareThemeCssCharacters} characters: ${item.path}`);
      }
      const existing = oldByObject.get(item.objectId);
      return {
        ...item,
        slug: existing?.slug ?? (item.slug || randomBytes(6).toString('base64url').toLowerCase()),
        checksum: createHash('sha256').update(JSON.stringify(item)).digest('hex'),
      };
    });
    const manifest = shareManifestSchema.parse({
      schemaVersion: 1, id: current?.id ?? randomUUID(), workspaceId: input.workspaceId,
      revision: (current?.revision ?? 0) + 1, items, createdAt: current?.createdAt ?? now, updatedAt: now,
    });
    this.manifests = current
      ? this.manifests.map((value) => value.id === current.id ? manifest : value)
      : [...this.manifests, manifest];
    this.store.write(this.manifests);
    const changedItems = items.filter((item) => oldByObject.get(item.objectId)?.checksum !== item.checksum).length;
    return sharePublishReceiptSchema.parse({ manifest, publishedAt: now, permalinkBase, changedItems });
  }
}

export async function verifyCustomDomain(domain: string, expectedTarget: string) {
  const normalized = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
  const records: string[] = [];
  try { records.push(...(await resolveCname(normalized)).map((value) => `CNAME ${value}`)); } catch { /* optional */ }
  try { records.push(...(await resolveTxt(normalized)).map((parts) => `TXT ${parts.join('')}`)); } catch { /* optional */ }
  const verified = records.some((record) => record.toLowerCase().includes(expectedTarget.toLowerCase()));
  return customDomainResultSchema.parse({
    domain: normalized, verified, records, expectedTarget,
    diagnostic: `Resolve DNS: nslookup -type=CNAME ${normalized}`,
    nextAction: verified ? 'DNS ownership verified.' : `Create a CNAME or TXT record pointing to ${expectedTarget}, wait for propagation, then retry.`,
  });
}
