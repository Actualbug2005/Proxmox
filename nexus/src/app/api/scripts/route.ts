import { NextResponse } from 'next/server';
import { fetchScriptIndex } from '@/lib/community-scripts';
import { getSession } from '@/lib/auth';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const scripts = await fetchScriptIndex();
    return NextResponse.json(scripts);
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to fetch scripts', detail: String(err) },
      { status: 502 },
    );
  }
}
