import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  RunScriptJobError,
  validateNodeName,
  validateScriptUrl,
} from './run-script-job';

describe('validateNodeName', () => {
  it('accepts standard PVE node names', () => {
    assert.equal(validateNodeName('pve1'), 'pve1');
    assert.equal(validateNodeName('node.example-host_01'), 'node.example-host_01');
  });

  it('rejects empty / non-string / too-long / injection-style input', () => {
    const bad = ['', ' ', '-hyphen-lead', 'a;b', 'foo bar', 'a'.repeat(70), 123, null, undefined];
    for (const input of bad) {
      assert.throws(
        () => validateNodeName(input as unknown),
        RunScriptJobError,
        `should reject: ${JSON.stringify(input)}`,
      );
    }
  });
});

describe('validateScriptUrl', () => {
  it('accepts community-scripts raw URLs', () => {
    const url = 'https://raw.githubusercontent.com/community-scripts/ProxmoxVE/main/ct/adguard.sh';
    const parsed = validateScriptUrl(url);
    assert.equal(parsed.origin, 'https://raw.githubusercontent.com');
  });

  it('rejects other origins', () => {
    assert.throws(
      () => validateScriptUrl('https://evil.com/community-scripts/ProxmoxVE/main/x.sh'),
      RunScriptJobError,
    );
  });

  it('rejects non-https schemes', () => {
    assert.throws(
      () => validateScriptUrl('http://raw.githubusercontent.com/community-scripts/ProxmoxVE/main/x.sh'),
      RunScriptJobError,
    );
  });

  it('rejects paths outside /community-scripts/ProxmoxVE/', () => {
    assert.throws(
      () => validateScriptUrl('https://raw.githubusercontent.com/other/repo/main/x.sh'),
      RunScriptJobError,
    );
  });

  it('rejects URLs with query or fragment', () => {
    assert.throws(
      () => validateScriptUrl('https://raw.githubusercontent.com/community-scripts/ProxmoxVE/main/x.sh?foo=1'),
      RunScriptJobError,
    );
    assert.throws(
      () => validateScriptUrl('https://raw.githubusercontent.com/community-scripts/ProxmoxVE/main/x.sh#top'),
      RunScriptJobError,
    );
  });

  it('rejects malformed URLs', () => {
    assert.throws(() => validateScriptUrl('not a url'), RunScriptJobError);
    assert.throws(() => validateScriptUrl(null as unknown), RunScriptJobError);
  });

  it('sets RunScriptJobError.status=400', () => {
    try {
      validateScriptUrl('https://evil.com/x');
      assert.fail('should have thrown');
    } catch (err) {
      assert.ok(err instanceof RunScriptJobError);
      assert.equal(err.status, 400);
    }
  });
});
