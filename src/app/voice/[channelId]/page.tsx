import VoiceRoom from '@/components/voice/VoiceRoom';

export const dynamic = 'force-dynamic';

export default async function VoiceChannelPage({
  params,
}: {
  params: Promise<{ channelId: string }>;
}) {
  const { channelId } = await params;
  return <VoiceRoom channelId={decodeURIComponent(channelId)} />;
}
