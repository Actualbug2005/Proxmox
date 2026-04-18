/**
 * Pin the template grammar. The renderer is the only path from (possibly
 * untrusted) event payload values into (operator-written) notification
 * strings, so the tests here are the injection-surface contract —
 * expanding the grammar later means updating these cases deliberately.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { collectKeys, renderTemplate } from './template.ts';

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
