import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export class JsonStore<T> {
  constructor(private readonly path: string, private readonly fallback: T) {}

  read(): T {
    try { return JSON.parse(readFileSync(this.path, 'utf8')) as T; }
    catch { return structuredClone(this.fallback); }
  }

  write(value: T): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    renameSync(temporary, this.path);
  }
}
