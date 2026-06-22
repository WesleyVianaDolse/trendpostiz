import { Metadata } from 'next';
import { LandingPage } from '@gitroom/frontend/components/landing/landing.page';

export const metadata: Metadata = {
  title: 'TrendPostiz | Social Media Management Dashboard',
  description:
    'TrendPostiz is a social media management platform that helps creators and businesses schedule posts, manage campaigns and publish content across TikTok, Facebook, Instagram and YouTube.',
  openGraph: {
    title: 'TrendPostiz | Social Media Management Dashboard',
    description:
      'TrendPostiz is a social media management platform that helps creators and businesses schedule posts, manage campaigns and publish content across TikTok, Facebook, Instagram and YouTube.',
    siteName: 'TrendPostiz',
    type: 'website',
    images: [
      {
        url: '/logo-escrito-branco.png',
        width: 1200,
        height: 630,
        alt: 'TrendPostiz',
      },
    ],
  },
};

export default async function Page() {
  return <LandingPage />;
}
