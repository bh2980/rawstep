/** Tracks pending launches too: a timed-out test cannot orphan a late browser. */
export class OwnedResources<T extends { close(): Promise<unknown> }> {
  private entries = new Set<Promise<T>>();
  private draining = false;
  private failed = false;
  private closers = new WeakMap<T, () => Promise<unknown>>();
  async acquire(factory: () => Promise<T>): Promise<T> {
    if (this.draining || this.failed) throw new Error('Resource cleanup incomplete; refusing another launch.');
    if (this.entries.size) throw new Error('A resource launch is still owned; close it before another launch.');
    const pending = Promise.resolve().then(factory).then(async value => {
      const original = value.close.bind(value);
      let closed: Promise<unknown> | undefined;
      const close = () => closed ??= Promise.resolve().then(original).catch(error => { this.failed = true; throw error; }).finally(() => this.entries.delete(pending));
      value.close = close;
      this.closers.set(value, close);
      if (this.draining || this.failed) { await value.close(); throw new Error('Launch completed after cleanup started.'); }
      return value;
    });
    this.entries.add(pending);
    // Observe late rejection even if the test itself has already timed out.
    void pending.catch(() => {});
    return pending;
  }
  async cleanup(timeoutMs = 5_000): Promise<void> {
    this.draining = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.all([...this.entries].map(async entry => {
          let value: T;
          try { value = await entry; } catch { if (this.failed) throw new Error('Resource close failed; refusing another launch.'); return; }
          await this.closers.get(value)!();
        })),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Resource cleanup timed out; stopping browser suite.')), timeoutMs); }),
      ]);
      this.entries.clear();
    } catch (error) { this.failed = true; throw error; }
    finally { clearTimeout(timer); this.draining = false; }
  }
}
