#!/usr/bin/env node --experimental-strip-types
/**
 * Offline decrypter for /var/log/nexus/exec-commands.enc.jsonl
 *
 * This script is NOT deployed to the running Nexus LXC. Run it on the
 * machine that holds the audit private key (your laptop / yubikey host)
 * during incident response.
 *
 *   Usage:
 *     nexus-audit-decrypt \
 *       --key   /path/to/audit-private.pem \
 *       --entry-id <ulid>  \                     # decrypt one entry
 *       /path/to/exec-commands.enc.jsonl
 *
 *     nexus-audit-decrypt \
 *       --key   /path/to/audit-private.pem \
 *       --all \                                  # decrypt every entry
 *       /path/to/exec-commands.enc.jsonl
 *
 *   Output (JSONL on stdout):
 *     { "id": "01HM0Z...", "cmd": "actual command text" }
 *
 * Runtime: Node 22+ (uses --experimental-strip-types to load .ts directly).
 * No compile step; drop-in and run.
 */

import { readFile } from 'node:fs/promises';
import { privateDecrypt, createDecipheriv, constants } from 'node:crypto';
import { AES_KEY_BYTES, AES_IV_BYTES, AUTH_TAG_BYTES } from '../src/lib/exec-audit.ts';

interface Args {
  keyPath: string;
  entryId?: string;
  all: boolean;
  logPath: string;
}

function parseArgs(argv: string[]): Args {
  const args: Partial<Args> = {};
  let positional: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--key') args.keyPath = argv[++i];
    else if (a === '--entry-id') args.entryId = argv[++i];
    else if (a === '--all') args.all = true;
    else if (a.startsWith('--')) throw new Error(`Unknown flag: ${a}`);
    else positional = a;
  }
  if (!args.keyPath) throw new Error('--key <private-key.pem> is required');
  if (!positional) throw new Error('log file path is required');
  if (!args.entryId && !args.all) {
    throw new Error('either --entry-id <id> or --all is required');
  }
  return {
    keyPath: args.keyPath,
    entryId: args.entryId,
    all: args.all ?? false,
    logPath: positional,
  };
}

function decryptEnvelope(privateKeyPem: Buffer, cipherB64: string): string {
  const envelope = Buffer.from(cipherB64, 'base64');
  // Frame: [len(wrappedKey) uint32 BE] [wrappedKey] [iv] [authTag] [ciphertext]
  const wrappedLen = envelope.readUInt32BE(0);
  let offset = 4;
  const wrappedKey = envelope.subarray(offset, offset + wrappedLen);
  offset += wrappedLen;
  const iv = envelope.subarray(offset, offset + AES_IV_BYTES);
  offset += AES_IV_BYTES;
  const authTag = envelope.subarray(offset, offset + AUTH_TAG_BYTES);
  offset += AUTH_TAG_BYTES;
  const ciphertext = envelope.subarray(offset);

  const aesKey = privateDecrypt(
    {
      key: privateKeyPem,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    wrappedKey,
  );
  if (aesKey.length !== AES_KEY_BYTES) {
    throw new Error(`Unexpected AES key length ${aesKey.length}, expected ${AES_KEY_BYTES}`);
  }

  // Pin the GCM auth-tag length to AUTH_TAG_BYTES so a truncated tag can't
  // pass verification. The producer in src/lib/exec-audit.ts uses the same
  // constant; without this option the decipher would accept tags shorter
  // than 16 bytes and an attacker could forge entries (CWE-310).
  const decipher = createDecipheriv('aes-256-gcm', aesKey, iv, {
    authTagLength: AUTH_TAG_BYTES,
  });
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [privateKey, log] = await Promise.all([
    readFile(args.keyPath),
    readFile(args.logPath, 'utf8'),
  ]);

  for (const line of log.split('\n')) {
    if (!line) continue;
    let entry: { id?: string; cmd_ciphertext?: string };
    try {
      entry = JSON.parse(line) as typeof entry;
    } catch {
      console.error(`skipping malformed line: ${line.slice(0, 80)}`);
      continue;
    }
    if (!entry.id || !entry.cmd_ciphertext) continue;
    if (args.entryId && entry.id !== args.entryId) continue;

    try {
      const plaintext = decryptEnvelope(privateKey, entry.cmd_ciphertext);
      process.stdout.write(JSON.stringify({ id: entry.id, cmd: plaintext }) + '\n');
      if (args.entryId) return; // single-entry mode: stop after match
    } catch (err) {
      // Use %s placeholders (not template-string concat) so externally
      // sourced values can't be interpreted as printf format specifiers
      // (semgrep CWE-134).
      console.error('decrypt failed for id=%s: %s', entry.id, err instanceof Error ? err.message : String(err));
    }
  }
  if (args.entryId) {
    console.error(`entry-id ${args.entryId} not found`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
