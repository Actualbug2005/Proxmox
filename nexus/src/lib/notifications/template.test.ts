/**
 * Pin the template grammar. The renderer is the only path from (possibly
 * untrusted) event payload values into (operator-written) notification
 * strings, so the tests here are the injection-surface contract —
 * expanding the grammar later means updating these cases deliberately.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { collectKeys, humaniseFiringFor, renderTemplate } from './template.ts';

describe('renderTemplate', () => {
  it('replaces matching keys in source order', () => {
    const out = renderTemplate('{{node}} at {{value}}%', {
      node: 'pve1',
      value: 87,
    });
    assert.equal(out, 'pve1 at 87%');
  });

  it('tolerates whitespace inside the braces', () => {
    assert.equal(renderTemplate('x {{ node }} y', { node: 'pve' }), 'x pve y');
  });

  it('renders missing / null / undefined keys as the empty string', () => {
    assert.equal(renderTemplate('a{{missing}}b', {}), 'ab');
    assert.equal(renderTemplate('a{{n}}b', { n: null }), 'ab');
    assert.equal(renderTemplate('a{{n}}b', { n: undefined }), 'ab');
  });

  it('stringifies non-string values via String()', () => {
    assert.equal(renderTemplate('{{n}} / {{b}}', { n: 42, b: true }), '42 / true');
  });

  it('does NOT interpret dotted tokens or dash-prefixed tokens', () => {
    // Dotted lookups and dash-prefixed keys are not part of the grammar —
    // the regex leaves them literal so a future grammar extension is an
    // additive change, not a silent behaviour shift.
    assert.equal(
      renderTemplate('{{a.b}} {{-q}}', { a: 'x' }),
      '{{a.b}} {{-q}}',
    );
  });

  it('handles triple-brace input by matching the inner token only', () => {
    // `{{{x}}}` isn't triple-brace-escaping (that would be mustache's
    // unescape-HTML form). Our narrow regex matches `{{x}}` and leaves
    // the outer braces as literals; document that here so anyone hitting
    // the behaviour sees it's deliberate, not a bug to "fix".
    assert.equal(renderTemplate('{{{x}}}', { x: 'y' }), '{y}');
  });

  it('cannot reach across object internals via crafted keys', () => {
    // Sanity: even with the narrow regex, no key like "__proto__" or
    // "constructor" can cause surprising behaviour — all it gets is a
    // lookup through the context's own properties, nothing more.
    assert.equal(renderTemplate('{{__proto__}}', {}), '');
    assert.equal(renderTemplate('{{constructor}}', {}), '');
  });
});

describe('collectKeys', () => {
  it('returns unique keys in source order', () => {
    assert.deepEqual(
      collectKeys('{{a}} and {{b}} and {{a}} again, plus {{c}}'),
      ['a', 'b', 'c'],
    );
  });
  it('returns [] on a template with no tokens', () => {
    assert.deepEqual(collectKeys('no tokens here'), []);
  });
});

describe('humaniseFiringFor', () => {
  it('formats < 1 minute as "just now"', () => {
    assert.equal(humaniseFiringFor(0), 'just now');
    assert.equal(humaniseFiringFor(30_000), 'just now');
    assert.equal(humaniseFiringFor(59_999), 'just now');
  });

  it('formats sub-hour durations as Nm', () => {
    assert.equal(humaniseFiringFor(60_000), '1m');
    assert.equal(humaniseFiringFor(23 * 60_000), '23m');
    assert.equal(humaniseFiringFor(59 * 60_000), '59m');
  });

  it('formats sub-day durations as Nh Nm (rounded down)', () => {
    assert.equal(humaniseFiringFor(60 * 60_000), '1h 0m');
    assert.equal(humaniseFiringFor(2 * 3600_000 + 14 * 60_000), '2h 14m');
    assert.equal(humaniseFiringFor(23 * 3600_000 + 59 * 60_000), '23h 59m');
  });

  it('formats day-plus durations as Nd Nh', () => {
    assert.equal(humaniseFiringFor(24 * 3600_000), '1d 0h');
    assert.equal(humaniseFiringFor(3 * 86_400_000 + 1 * 3600_000), '3d 1h');
    assert.equal(humaniseFiringFor(7 * 86_400_000), '7d 0h');
  });

  it('returns empty string for negative or NaN input', () => {
    assert.equal(humaniseFiringFor(-1), '');
    assert.equal(humaniseFiringFor(NaN), '');
    assert.equal(humaniseFiringFor(Number.NEGATIVE_INFINITY), '');
  });
});
