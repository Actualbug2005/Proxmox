import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

describe('certificates-tab module', () => {
  it('exports CertificatesTab', async () => {
    const mod = await import('./certificates-tab');
    assert.equal(typeof mod.CertificatesTab, 'function');
  });
});
