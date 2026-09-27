import { releaseVersion } from '@vianoor/ui';
export const dynamic = 'force-dynamic';
export function GET() {
  return Response.json(
    { version: releaseVersion, stage: 9 },
    {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    },
  );
}
