'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Cloud,
  Film,
  Lock,
  Megaphone,
  MonitorCheck,
  PlayCircle,
  ShieldCheck,
  Sparkles,
  Users,
  Workflow,
  Zap,
} from 'lucide-react';

const platformCards = [
  {
    name: 'TikTok',
    icon: '/icons/platforms/tiktok.png',
    detail: 'TikTok Login Kit',
  },
  {
    name: 'Facebook',
    icon: '/icons/platforms/facebook.png',
    detail: 'Official API',
  },
  {
    name: 'Instagram',
    icon: '/icons/platforms/instagram.png',
    detail: 'Official API',
  },
  {
    name: 'YouTube',
    icon: '/icons/platforms/youtube.png',
    detail: 'Official API',
  },
  {
    name: 'Google My Business',
    icon: '/icons/platforms/gmb.png',
    detail: 'Official API',
  },
];

const featureCards = [
  {
    title: 'Connect Social Accounts',
    description:
      'Securely connect TikTok, Facebook, Instagram, YouTube and Google My Business using official APIs.',
    icon: ShieldCheck,
  },
  {
    title: 'Schedule Content',
    description: 'Plan and automate your publishing strategy.',
    icon: CalendarDays,
  },
  {
    title: 'Publish Videos',
    description: 'Upload and publish videos from a centralized dashboard.',
    icon: Film,
  },
  {
    title: 'Campaign Management',
    description: 'Organize content and campaigns efficiently.',
    icon: Megaphone,
  },
  {
    title: 'Publishing Status',
    description: 'Track posts and publishing results in real time.',
    icon: MonitorCheck,
  },
  {
    title: 'Multi-Account Management',
    description: 'Manage multiple brands and social profiles from one place.',
    icon: Users,
  },
];

const timelineSteps = [
  { title: 'Create Account', icon: Users },
  { title: 'Connect Platforms', icon: Workflow },
  { title: 'Upload Content', icon: Cloud },
  { title: 'Schedule Posts', icon: Clock3 },
  { title: 'Monitor Publishing', icon: BarChart3 },
];

const securityCards = [
  {
    title: 'Official Platform APIs',
    description: 'TrendPostiz uses official APIs and TikTok Login Kit.',
    icon: ShieldCheck,
  },
  {
    title: 'Data Protection',
    description: 'User credentials and tokens are securely stored.',
    icon: Lock,
  },
  {
    title: 'Secure Authentication',
    description: 'Authentication follows platform security standards.',
    icon: CheckCircle2,
  },
];

const floatingPosts = [
  {
    label: 'TikTok',
    title: 'Short video queued',
    position: 'lg:left-0 lg:top-24',
    icon: '/icons/platforms/tiktok.png',
  },
  {
    label: 'Instagram',
    title: 'Reel scheduled',
    position: 'lg:right-0 lg:top-16',
    icon: '/icons/platforms/instagram.png',
  },
  {
    label: 'Facebook',
    title: 'Campaign post ready',
    position: 'lg:left-10 lg:bottom-20',
    icon: '/icons/platforms/facebook.png',
  },
  {
    label: 'YouTube',
    title: 'Video publishing',
    position: 'lg:right-12 lg:bottom-14',
    icon: '/icons/platforms/youtube.png',
  },
  {
    label: 'Google My Business',
    title: 'Business post queued',
    position: 'lg:right-36 lg:top-[48%]',
    icon: '/icons/platforms/gmb.png',
  },
];

const actionLink = '/auth';
const loginLink = '/auth/login';

export function LandingPage() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    const hasCookie = document.cookie
      .split('; ')
      .some((item) => item.trim().startsWith('auth='));
    setIsAuthenticated(hasCookie);
  }, []);

  const primaryHref = isAuthenticated ? '/launches' : actionLink;
  const primaryLabel = isAuthenticated ? 'Dashboard' : 'Get Started';

  return (
    <div className="min-h-screen overflow-hidden bg-[#030207] text-white">
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute left-1/2 top-[-220px] h-[520px] w-[820px] -translate-x-1/2 rounded-full bg-[#3a0d76]/35 blur-[140px]" />
        <div className="absolute bottom-[20%] right-[-200px] h-[420px] w-[420px] rounded-full bg-[#5b1ab0]/20 blur-[120px]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:72px_72px] opacity-30" />
      </div>

      <header className="fixed left-0 right-0 top-0 z-50 border-b border-white/10 bg-[#05030a]/75 backdrop-blur-xl">
        <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" aria-label="TrendPostiz home" className="flex items-center">
            <Image
              src="/logo-escrito-branco.png"
              alt="TrendPostiz"
              width={188}
              height={42}
              priority
              className="h-10 w-auto"
            />
          </Link>

          <nav className="flex items-center gap-2 sm:gap-3">
            {isAuthenticated ? (
              <Link
                href="/launches"
                className="rounded-md border border-white/15 px-4 py-2 text-sm font-semibold text-white transition hover:border-[#8f5cff]/60 hover:bg-white/10"
              >
                Dashboard
              </Link>
            ) : (
              <Link
                href={loginLink}
                className="rounded-md px-4 py-2 text-sm font-semibold text-white/80 transition hover:bg-white/10 hover:text-white"
              >
                Login
              </Link>
            )}
            <Link
              href={primaryHref}
              className="rounded-md bg-[#6c2ff2] px-4 py-2 text-sm font-semibold text-white shadow-[0_0_28px_rgba(108,47,242,0.45)] transition hover:bg-[#7b43ff]"
            >
              {primaryLabel}
            </Link>
          </nav>
        </div>
      </header>

      <main className="relative z-10">
        <section className="px-4 pb-20 pt-32 sm:px-6 lg:px-8 lg:pb-28">
          <div className="mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-[0.94fr_1.06fr]">
            <div className="animate-fade">
              <div className="mb-6 inline-flex items-center gap-2 rounded-md border border-[#7c3cff]/30 bg-[#180b2c]/80 px-3 py-2 text-sm font-semibold text-[#d8c9ff]">
                <Sparkles size={16} />
                Official integrations for modern publishing teams
              </div>
              <h1 className="max-w-4xl text-4xl font-bold leading-[1.05] text-white sm:text-5xl lg:text-7xl">
                Manage All Your Social Media From One Dashboard
              </h1>
              <p className="mt-6 max-w-2xl text-base leading-8 text-white/70 sm:text-lg">
                Schedule posts, publish content, manage campaigns and connect
                your social media accounts through official platform
                integrations.
              </p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <Link
                  href={primaryHref}
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-[#6c2ff2] px-6 py-3 text-sm font-bold text-white shadow-[0_0_36px_rgba(108,47,242,0.45)] transition hover:-translate-y-0.5 hover:bg-[#7b43ff]"
                >
                  {primaryLabel}
                  <Zap size={17} />
                </Link>
                {!isAuthenticated && (
                  <Link
                    href={loginLink}
                    className="inline-flex items-center justify-center rounded-md border border-white/15 px-6 py-3 text-sm font-bold text-white transition hover:-translate-y-0.5 hover:border-[#8f5cff]/60 hover:bg-white/10"
                  >
                    Login
                  </Link>
                )}
              </div>
              <div className="mt-9 grid max-w-xl grid-cols-3 gap-3 text-sm text-white/60">
                <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
                  <strong className="block text-xl text-white">5</strong>
                  Core platforms
                </div>
                <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
                  <strong className="block text-xl text-white">API</strong>
                  Official access
                </div>
                <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
                  <strong className="block text-xl text-white">Live</strong>
                  Status tracking
                </div>
              </div>
            </div>

            <div className="relative min-h-[620px] animate-fade">
              <DashboardMockup />
              {floatingPosts.map((post, index) => (
                <div
                  key={post.label}
                  className={`absolute hidden w-56 rounded-lg border border-white/12 bg-[#090611]/90 p-4 shadow-[0_18px_60px_rgba(0,0,0,0.35)] backdrop-blur-xl transition hover:-translate-y-1 hover:border-[#8f5cff]/60 lg:block ${post.position}`}
                  style={{ animationDelay: `${index * 110}ms` }}
                >
                  <div className="flex items-center gap-3">
                    <Image src={post.icon} alt="" width={28} height={28} />
                    <div>
                      <div className="text-xs font-semibold uppercase text-[#b79dff]">
                        {post.label}
                      </div>
                      <div className="text-sm font-semibold text-white">
                        {post.title}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-y border-white/10 bg-white/[0.025] px-4 py-16 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <div className="mb-8 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
              <div>
                <p className="text-sm font-bold uppercase text-[#b79dff]">
                  Supported Platforms
                </p>
                <h2 className="mt-2 text-3xl font-bold sm:text-4xl">
                  Built for the channels your audience uses
                </h2>
              </div>
              <p className="max-w-xl text-sm leading-7 text-white/60">
                TrendPostiz connects through official APIs so publishing stays
                aligned with platform security expectations.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {platformCards.map((platform) => (
                <div
                  key={platform.name}
                  className="rounded-lg border border-white/10 bg-[#08050f] p-5 transition hover:-translate-y-1 hover:border-[#7c3cff]/70 hover:shadow-[0_0_36px_rgba(108,47,242,0.18)]"
                >
                  <div className="flex items-center justify-between gap-4">
                    <Image
                      src={platform.icon}
                      alt={`${platform.name} icon`}
                      width={40}
                      height={40}
                    />
                    <span className="rounded-md bg-[#1c0f32] px-3 py-1 text-xs font-bold text-[#d8c9ff]">
                      Official
                    </span>
                  </div>
                  <h3 className="mt-5 text-xl font-bold">{platform.name}</h3>
                  <p className="mt-2 text-sm text-white/60">
                    {platform.detail} integration
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <SectionHeader
          eyebrow="Features"
          title="Everything needed to plan, publish and track content"
          description="A focused workspace for teams that need social publishing to feel organized, secure and ready for review."
        />
        <section className="px-4 pb-20 sm:px-6 lg:px-8">
          <div className="mx-auto grid max-w-7xl grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
            {featureCards.map((feature, index) => {
              const Icon = feature.icon;
              return (
                <div
                  key={feature.title}
                  className="group rounded-lg border border-white/10 bg-[#08050f] p-6 transition duration-300 hover:-translate-y-1 hover:scale-[1.015] hover:border-[#7c3cff]/70 hover:bg-[#0d0718] hover:shadow-[0_0_42px_rgba(108,47,242,0.2)]"
                  style={{ animationDelay: `${index * 80}ms` }}
                >
                  <div className="mb-6 flex h-11 w-11 items-center justify-center rounded-lg bg-[#1d0c37] text-[#cbb8ff] transition group-hover:bg-[#6c2ff2] group-hover:text-white">
                    <Icon size={21} />
                  </div>
                  <h3 className="text-xl font-bold">{feature.title}</h3>
                  <p className="mt-3 leading-7 text-white/60">
                    {feature.description}
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        <section className="border-y border-white/10 bg-[#06030b] px-4 py-20 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <SectionTitle
              eyebrow="How It Works"
              title="From account setup to publishing insights"
            />
            <div className="relative mt-14 grid gap-5 lg:grid-cols-5">
              <div className="absolute left-0 right-0 top-11 hidden h-px bg-gradient-to-r from-transparent via-[#7c3cff]/60 to-transparent lg:block" />
              {timelineSteps.map((step, index) => {
                const Icon = step.icon;
                return (
                  <div key={step.title} className="relative rounded-lg border border-white/10 bg-[#08050f] p-5 transition hover:-translate-y-1 hover:border-[#7c3cff]/70">
                    <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-lg bg-[#6c2ff2] shadow-[0_0_26px_rgba(108,47,242,0.4)]">
                      <Icon size={22} />
                    </div>
                    <div className="text-sm font-bold text-[#b79dff]">
                      Step {index + 1}
                    </div>
                    <h3 className="mt-2 text-lg font-bold">{step.title}</h3>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <SectionHeader
          eyebrow="Security"
          title="Premium security cues for platform reviews"
          description="Clear, review-friendly messaging around official APIs, protected tokens and trusted authentication flows."
        />
        <section className="px-4 pb-20 sm:px-6 lg:px-8">
          <div className="mx-auto grid max-w-7xl grid-cols-1 gap-5 md:grid-cols-3">
            {securityCards.map((card) => {
              const Icon = card.icon;
              return (
                <div
                  key={card.title}
                  className="rounded-lg border border-[#7c3cff]/25 bg-[linear-gradient(145deg,rgba(124,60,255,0.13),rgba(255,255,255,0.025))] p-7 shadow-[0_0_42px_rgba(108,47,242,0.11)] transition hover:-translate-y-1 hover:border-[#9b75ff]/70"
                >
                  <Icon className="text-[#cbb8ff]" size={28} />
                  <h3 className="mt-6 text-xl font-bold">{card.title}</h3>
                  <p className="mt-3 leading-7 text-white/65">
                    {card.description}
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        <section className="px-4 pb-20 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl overflow-hidden rounded-lg border border-[#7c3cff]/30 bg-[#08050f] p-8 shadow-[0_0_70px_rgba(108,47,242,0.18)] sm:p-12 lg:p-16">
            <div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-center">
              <div>
                <p className="text-sm font-bold uppercase text-[#b79dff]">
                  Ready when you are
                </p>
                <h2 className="mt-3 text-3xl font-bold sm:text-5xl">
                  Start Managing Social Media Smarter
                </h2>
                <p className="mt-5 max-w-3xl text-lg leading-8 text-white/65">
                  Join creators, agencies and businesses using TrendPostiz to
                  organize and publish content more efficiently.
                </p>
              </div>
              <Link
                href={primaryHref}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-[#6c2ff2] px-7 py-4 text-sm font-bold text-white shadow-[0_0_36px_rgba(108,47,242,0.45)] transition hover:-translate-y-0.5 hover:bg-[#7b43ff]"
              >
                {primaryLabel}
                <PlayCircle size={18} />
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-white/10 bg-[#030207] px-4 py-10 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-7xl gap-8 md:grid-cols-[1.3fr_1fr_1fr]">
          <div>
            <Image
              src="/logo-escrito-branco.png"
              alt="TrendPostiz"
              width={168}
              height={38}
              className="h-9 w-auto"
            />
            <p className="mt-4 max-w-md text-sm leading-7 text-white/55">
              Social media management for creators, agencies and businesses
              publishing across official platform integrations.
            </p>
          </div>
          <div>
            <h3 className="text-sm font-bold uppercase text-white/80">Legal</h3>
            <div className="mt-4 flex flex-col gap-3 text-sm text-white/55">
              <Link href="/privacy" className="transition hover:text-white">
                Privacy Policy
              </Link>
              <Link href="/terms" className="transition hover:text-white">
                Terms of Service
              </Link>
            </div>
          </div>
          <div>
            <h3 className="text-sm font-bold uppercase text-white/80">
              Support
            </h3>
            <div className="mt-4 flex flex-col gap-3 text-sm text-white/55">
              <a
                href="mailto:support@trendpostiz.com.br"
                className="transition hover:text-white"
              >
                support@trendpostiz.com.br
              </a>
              <Link href={loginLink} className="transition hover:text-white">
                Login
              </Link>
            </div>
          </div>
        </div>
        <div className="mx-auto mt-10 max-w-7xl border-t border-white/10 pt-6 text-sm text-white/45">
          &copy; 2026 TrendPostiz. All rights reserved.
        </div>
      </footer>
    </div>
  );
}

function DashboardMockup() {
  return (
    <div className="relative mx-auto max-w-2xl rounded-lg border border-white/12 bg-[#08050f] p-4 shadow-[0_30px_110px_rgba(0,0,0,0.5),0_0_80px_rgba(108,47,242,0.18)]">
      <div className="rounded-lg border border-white/10 bg-[#0d0916] p-5">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-[#b79dff]">
              Editorial Calendar
            </p>
            <h2 className="mt-1 text-2xl font-bold">June Campaigns</h2>
          </div>
          <div className="rounded-md bg-[#1b1031] px-3 py-2 text-sm font-bold text-[#d8c9ff]">
            18 scheduled
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-7">
          {Array.from({ length: 14 }).map((_, index) => (
            <div
              key={index}
              className={`min-h-[72px] rounded-lg border p-2 ${
                [2, 4, 8, 10, 12].includes(index)
                  ? 'border-[#7c3cff]/55 bg-[#251145]'
                  : 'border-white/10 bg-white/[0.025]'
              }`}
            >
              <span className="text-xs text-white/45">{index + 10}</span>
              {[2, 8, 12].includes(index) && (
                <div className="mt-3 h-2 rounded-full bg-[#a78bfa]" />
              )}
              {[4, 10].includes(index) && (
                <div className="mt-3 space-y-1">
                  <div className="h-2 rounded-full bg-[#f472b6]" />
                  <div className="h-2 w-2/3 rounded-full bg-[#60a5fa]" />
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_0.8fr]">
          <div className="rounded-lg border border-white/10 bg-[#08050f] p-4">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-bold">Scheduled Posts</h3>
              <span className="text-xs text-white/45">Today</span>
            </div>
            {[
              ['TikTok launch clip', 'Ready', 'bg-emerald-400'],
              ['Instagram carousel', 'Scheduled', 'bg-[#a78bfa]'],
              ['YouTube product demo', 'Processing', 'bg-amber-300'],
            ].map(([title, status, color]) => (
              <div
                key={title}
                className="mb-3 flex items-center justify-between rounded-lg bg-white/[0.035] p-3 last:mb-0"
              >
                <div>
                  <p className="text-sm font-semibold">{title}</p>
                  <p className="mt-1 text-xs text-white/45">Campaign Alpha</p>
                </div>
                <span className="flex items-center gap-2 text-xs text-white/70">
                  <span className={`h-2 w-2 rounded-full ${color}`} />
                  {status}
                </span>
              </div>
            ))}
          </div>

          <div className="rounded-lg border border-white/10 bg-[#08050f] p-4">
            <h3 className="font-bold">Publishing Status</h3>
            <div className="mt-5 space-y-4">
              {[
                ['Published', '72%'],
                ['Queued', '48%'],
                ['Review', '31%'],
              ].map(([label, width]) => (
                <div key={label}>
                  <div className="mb-2 flex justify-between text-xs text-white/55">
                    <span>{label}</span>
                    <span>{width}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-[#7c3cff]"
                      style={{ width }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-6 rounded-lg bg-[#1b1031] p-4">
              <div className="text-xs uppercase text-[#b79dff]">Campaigns</div>
              <div className="mt-1 text-2xl font-bold">6 active</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <section className="px-4 pb-12 pt-20 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl text-center">
        <p className="text-sm font-bold uppercase text-[#b79dff]">{eyebrow}</p>
        <h2 className="mt-3 text-3xl font-bold sm:text-5xl">{title}</h2>
        <p className="mx-auto mt-5 max-w-2xl leading-7 text-white/60">
          {description}
        </p>
      </div>
    </section>
  );
}

function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="max-w-3xl">
      <p className="text-sm font-bold uppercase text-[#b79dff]">{eyebrow}</p>
      <h2 className="mt-3 text-3xl font-bold sm:text-5xl">{title}</h2>
    </div>
  );
}
