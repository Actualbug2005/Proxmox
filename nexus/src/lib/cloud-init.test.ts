import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { buildIpconfig, normalizeSshKeys } from './cloud-init';

describe('normalizeSshKeys', () => {
  it('accepts a single valid ssh-ed25519 key', () => {
    const out = normalizeSshKeys('ssh-ed25519 AAAAC3NzaC1lZDI1NTE5 user@host');
    assert.equal(out.ok, true);
    if (out.ok) {
      assert.equal(out.count, 1);
      assert.match(out.value, /^ssh-ed25519 AAAAC3NzaC1lZDI1NTE5 user@host$/);
    }
  });

  it('accepts multiple keys, one per line', () => {
    const input = [
      'ssh-ed25519 AAA user@a',
      'ssh-rsa BBB user@b',
    ].join('\n');
    const out = normalizeSshKeys(input);
    assert.equal(out.ok, true);
    if (out.ok) {
      assert.equal(out.count, 2);
      assert.equal(out.value.split('\n').length, 2);
    }
  });

  it('normalizes CRLF line endings', () => {
    const out = normalizeSshKeys('ssh-ed25519 AAA user@a\r\nssh-rsa BBB user@b\r\n');
    assert.equal(out.ok, true);
    if (out.ok) assert.equal(out.count, 2);
  });

  it('strips blank lines and comments', () => {
    const input = [
      '# my keys',
      '',
      'ssh-ed25519 AAA user@a',
      '   ',
      '# another note',
      'ssh-rsa BBB user@b',
    ].join('\n');
    const out = normalizeSshKeys(input);
    assert.equal(out.ok, true);
    if (out.ok) assert.equal(out.count, 2);
  });

  it('rejects lines that do not start with a known algorithm', () => {
    const out = normalizeSshKeys('ssh-ed25519 AAA ok\nnot-a-key\nssh-rsa BBB ok');
    assert.equal(out.ok, false);
    if (!out.ok) {
      assert.equal(out.errors.length, 1);
      assert.match(out.errors[0], /Line 2/);
      assert.match(out.errors[0], /recognized SSH algorithm prefix/);
    }
  });

  it('accepts ecdsa + sk-* algorithm prefixes', () => {
    const out = normalizeSshKeys(
      [
        'ecdsa-sha2-nistp256 AAA u',
        'sk-ssh-ed25519@openssh.com BBB u',
      ].join('\n'),
    );
    assert.equal(out.ok, true);
    if (out.ok) assert.equal(out.count, 2);
  });

  it('empty input returns ok with count=0', () => {
    const out = normalizeSshKeys('');
    assert.equal(out.ok, true);
    if (out.ok) {
      assert.equal(out.count, 0);
      assert.equal(out.value, '');
    }
  });
});

describe('buildIpconfig', () => {
  it('IPv4 DHCP only', () => {
    assert.equal(
      buildIpconfig({ ipv4Mode: 'dhcp', ipv6Mode: 'none' }),
      'ip=dhcp',
    );
  });

  it('IPv4 static with gateway', () => {
    assert.equal(
      buildIpconfig({
        ipv4Mode: 'static',
        ipv4Cidr: '10.0.0.5/24',
        ipv4Gw: '10.0.0.1',
        ipv6Mode: 'none',
      }),
      'ip=10.0.0.5/24,gw=10.0.0.1',
    );
  });

  it('IPv4 DHCP + IPv6 static together', () => {
    assert.equal(
      buildIpconfig({
        ipv4Mode: 'dhcp',
        ipv6Mode: 'static',
        ipv6Cidr: 'fd00::5/64',
        ipv6Gw: 'fd00::1',
      }),
      'ip=dhcp,ip6=fd00::5/64,gw6=fd00::1',
    );
  });

  it('IPv6 auto alone', () => {
    assert.equal(
      buildIpconfig({ ipv4Mode: 'none', ipv6Mode: 'auto' }),
      'ip6=auto',
    );
  });

  it('both modes none → empty string', () => {
    assert.equal(
      buildIpconfig({ ipv4Mode: 'none', ipv6Mode: 'none' }),
      '',
    );
  });

  it('static v4 without CIDR omits the ip= part silently', () => {
    // Form should disable the Next button in this state; the function
    // still produces something parseable rather than throwing.
    assert.equal(
      buildIpconfig({ ipv4Mode: 'static', ipv4Gw: '10.0.0.1', ipv6Mode: 'none' }),
      'gw=10.0.0.1',
    );
  });
});
