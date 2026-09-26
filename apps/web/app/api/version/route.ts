import { releaseVersion } from '@vianoor/ui';
export const dynamic = 'force-dynamic';
export function GET() {
  return Response.json(
    { version: releaseVersion, stage: 6 },
    {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    },
  );
}
