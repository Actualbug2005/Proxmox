/**
 * Destinations CRUD — list + create.
 *
 * `secretBlob` is stripped from every response so the encrypted
 * ciphertext never leaves the server. The UI only needs the name /
 * kind / timestamps to render the table.
 */
import { NextResponse } from 'next/server';
import { withAuth, withCsrf } from '@/lib/route-middleware';
import {
  createDestination,
  listDestinations,
} from '@/lib/notifications/store';
import type { Destination } from '@/lib/notifications/types';
import { parseDestinationInput } from '../validators';

export interface DestinationSummary {
  id: string;
  name: string;
  kind: Destination['kind'];
  createdAt: number;
  updatedAt: number;
}

function summarise(d: Destination): DestinationSummary {
  return { id: d.id, name: d.name, kind: d.kind, createdAt: d.createdAt, updatedAt: d.updatedAt };
}

export const GET = withAuth(async () => {
  const all = await listDestinations();
  return NextResponse.json({ destinations: all.map(summarise) }, {
    headers: { 'Cache-Control': 'no-store, private' },
  });
});

export const POST = withCsrf(async (req) => {
  const raw = await req.json().catch(() => ({}));
  const parsed = parseDestinationInput(raw);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const created = await createDestination(parsed.value);
  return NextResponse.json({ destination: summarise(created) }, { status: 201 });
});
