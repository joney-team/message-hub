import type { Metadata } from 'next';
import { ChannelStudio } from '@/studio/ChannelStudio';

export const metadata: Metadata = {
  title: 'Channel Studio - Message Hub',
  description: 'Inspect, customize and debug Message Hub channels.',
  robots: { index: false, follow: false },
};

export default function Home() {
  return <ChannelStudio />;
}
