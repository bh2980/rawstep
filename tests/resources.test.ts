import { describe, expect, it, vi } from 'vitest';
import { OwnedResources } from './helpers/resources.js';
describe('owned launch cleanup without any browser', () => {
  it('drains a failed launch before permitting a new one', async () => {
    const resources = new OwnedResources<{ close(): Promise<void> }>();
    await expect(resources.acquire(async () => { throw new Error('launch failed'); })).rejects.toThrow('launch failed');
    await resources.cleanup();
    const close = vi.fn(async () => {});
    await resources.acquire(async () => ({ close })); await resources.cleanup();
    expect(close).toHaveBeenCalledOnce();
  });
  it('refuses overlapping launches until the currently owned resource is closed', async () => {
    const resources = new OwnedResources<{ close(): Promise<void> }>();
    const first = await resources.acquire(async () => ({ close: vi.fn(async () => {}) }));
    const factory = vi.fn(async () => ({ close: async () => {} }));
    await expect(resources.acquire(factory)).rejects.toThrow('still owned'); expect(factory).not.toHaveBeenCalled();
    await first.close(); await resources.acquire(factory); await resources.cleanup(); expect(factory).toHaveBeenCalledOnce();
  });
  it('closes a launch completing after cleanup started', async () => {
    const resources = new OwnedResources<{ close(): Promise<void> }>();
    let release!: (value: { close(): Promise<void> }) => void;
    const close = vi.fn(async () => {});
    const launch = resources.acquire(() => new Promise(resolve => { release = resolve; }));
    await Promise.resolve(); const draining = resources.cleanup(); release({ close });
    await expect(launch).rejects.toThrow('after cleanup'); await draining; expect(close).toHaveBeenCalledOnce();
  });
  it('blocks further launches on cleanup failure', async () => {
    const resources = new OwnedResources<{ close(): Promise<void> }>();
    const close = vi.fn(async () => { throw new Error('failed'); });
    await resources.acquire(async () => ({ close })); await expect(resources.cleanup()).rejects.toThrow('failed');
    await expect(resources.acquire(async () => ({ close }))).rejects.toThrow('refusing'); expect(close).toHaveBeenCalledOnce();
  });
  it('stops when a launch cannot be drained', async () => {
    const resources = new OwnedResources<{ close(): Promise<void> }>();
    void resources.acquire(() => new Promise(() => {})); await expect(resources.cleanup(5)).rejects.toThrow('timed out');
    await expect(resources.acquire(async () => ({ close: async () => {} }))).rejects.toThrow('refusing');
  });
});
