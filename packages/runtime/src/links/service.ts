import { linkEdgeSchema, linkedObjectSchema, type LinkEdge, type LinkedObject } from '@vai/contracts/adoption';
import { JsonStore } from '../persistence/json-store.js';

interface LinkDocument { objects: LinkedObject[]; edges: LinkEdge[]; }

function extractReferences(content: string): Array<{ targetRef: string; label: string }> {
  const references: Array<{ targetRef: string; label: string }> = [];
  for (const match of content.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g)) {
    references.push({ targetRef: match[1].trim(), label: (match[2] ?? match[1]).trim() });
  }
  for (const match of content.matchAll(/\[([^\]]+)\]\((?!https?:|mailto:|#)([^)]+)\)/g)) {
    references.push({ targetRef: match[2].trim(), label: match[1].trim() });
  }
  return references;
}

export class LinkIndexService {
  private document: LinkDocument;
  constructor(private readonly store: JsonStore<LinkDocument>, private readonly now = () => Date.now()) {
    const raw = store.read();
    this.document = {
      objects: raw.objects.flatMap((value) => { const parsed = linkedObjectSchema.safeParse(value); return parsed.success ? [parsed.data] : []; }),
      edges: raw.edges.flatMap((value) => { const parsed = linkEdgeSchema.safeParse(value); return parsed.success ? [parsed.data] : []; }),
    };
  }
  update(workspaceId: string, object: LinkedObject, content: string): LinkEdge[] {
    const validated = linkedObjectSchema.parse(object);
    this.document.objects = [...this.document.objects.filter((item) => item.id !== validated.id), validated];
    this.document.edges = this.document.edges.filter((edge) => !(edge.workspaceId === workspaceId && edge.sourceId === validated.id));
    const edges = extractReferences(content).map((reference) => linkEdgeSchema.parse({
      workspaceId, sourceId: validated.id, ...reference, updatedAt: this.now(),
    }));
    this.document.edges.push(...edges); this.store.write(this.document); return edges;
  }
  backlinks(workspaceId: string, targetRef: string): Array<{ edge: LinkEdge; source?: LinkedObject }> {
    const target = targetRef.replace(/\\/g, '/').toLowerCase();
    return this.document.edges
      .filter((edge) => edge.workspaceId === workspaceId && edge.targetRef.replace(/\\/g, '/').toLowerCase() === target)
      .map((edge) => ({ edge, source: this.document.objects.find((object) => object.id === edge.sourceId) }));
  }
  graph(workspaceId: string): LinkDocument {
    const edges = this.document.edges.filter((edge) => edge.workspaceId === workspaceId);
    const objectIds = new Set(edges.flatMap((edge) => [edge.sourceId]));
    return { objects: this.document.objects.filter((object) => objectIds.has(object.id)), edges };
  }
  listObjects(): LinkedObject[] { return [...this.document.objects]; }
  restoreObjects(records: readonly LinkedObject[], overwrite: boolean): number {
    const existing = new Set(this.document.objects.map((record) => record.id));
    const accepted = records.map((record) => linkedObjectSchema.parse(record)).filter((record) => overwrite || !existing.has(record.id));
    if (overwrite) {
      const ids = new Set(accepted.map((record) => record.id));
      this.document.objects = this.document.objects.filter((record) => !ids.has(record.id));
    }
    this.document.objects.push(...accepted); this.store.write(this.document); return accepted.length;
  }
}
