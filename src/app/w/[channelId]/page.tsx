import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import { getChannel } from '@/server/services/channels';
import { normalizeSettings } from '@/settings';
import { ChatApp } from '@/widget/ChatApp';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Chat', robots: { index: false, follow: false } };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default async function WidgetPage({ params, searchParams }: { params: Promise<{ channelId: string }>; searchParams: Promise<{ preview?: string }> }) {
  const [{ channelId }, { preview }] = await Promise.all([params, searchParams]);
  const channel = getChannel(channelId);
  if (!channel) notFound();
  return <ChatApp channelId={channel.id} channelName={channel.name} initialSettings={normalizeSettings(channel.settings, channel.id)} preview={preview === '1'} />;
}
