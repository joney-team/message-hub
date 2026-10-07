import type { Metadata } from 'next';
import { ChannelStudio } from '@/studio/ChannelStudio';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Message Hub Studio',
  description: 'Inspect, customize and debug Message Hub channels.',
  robots: { index: false, follow: false },
};

export default function Home() {
  return <ChannelStudio />;
}
