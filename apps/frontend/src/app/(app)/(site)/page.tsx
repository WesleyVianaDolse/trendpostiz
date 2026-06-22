import { Metadata } from 'next';
import { LandingPage } from '@gitroom/frontend/components/landing/landing.page';
import { isGeneralServerSide } from '@gitroom/helpers/utils/is.general.server.side';

export const metadata: Metadata = {
  title: 'TrendPostiz - Social Media Management Platform',
  description: 'Connect, schedule and publish content across social media platforms.',
};

export default async function Page() {
  return <LandingPage />;
}
