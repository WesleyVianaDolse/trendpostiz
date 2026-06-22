'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

export function LandingPage() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    // Check if user has auth cookie
    const hasCookie = document.cookie
      .split('; ')
      .some((item) => item.trim().startsWith('auth='));
    setIsAuthenticated(hasCookie);
  }, []);

  return (
    <div className="min-h-screen bg-primary text-white">
      {/* Navigation */}
      <nav className="fixed w-full top-0 z-50 bg-primary/95 backdrop-blur-sm border-b border-new-border">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-new-btn-primary flex items-center justify-center font-bold">
              T
            </div>
            <span className="text-xl font-bold">TrendPostiz</span>
          </div>
          <div className="flex gap-4">
            {isAuthenticated ? (
              <>
                <Link
                  href="/launches"
                  className="px-6 py-2 rounded-lg text-white hover:bg-new-btn-simple transition-colors"
                >
                  Dashboard
                </Link>
                <Link
                  href="/auth/logout"
                  className="px-6 py-2 rounded-lg bg-new-btn-primary text-white hover:bg-new-btn-primary/80 transition-colors"
                >
                  Logout
                </Link>
              </>
            ) : (
              <>
                <Link
                  href="/auth/login"
                  className="px-6 py-2 rounded-lg text-white hover:bg-new-btn-simple transition-colors"
                >
                  Login
                </Link>
                <Link
                  href="/auth/register"
                  className="px-6 py-2 rounded-lg bg-new-btn-primary text-white hover:bg-new-btn-primary/80 transition-colors"
                >
                  Get Started
                </Link>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-32 pb-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold mb-6 -tracking-0.8">
            Social Media Management Platform
          </h1>
          <p className="text-lg sm:text-xl text-gray-300 mb-8 max-w-2xl mx-auto">
            Connect your TikTok and other social accounts, schedule posts, upload videos, and manage publishing workflows from one dashboard.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            {!isAuthenticated ? (
              <>
                <Link
                  href="/auth/register"
                  className="px-8 py-3 rounded-lg bg-new-btn-primary text-white font-semibold hover:bg-new-btn-primary/80 transition-colors"
                >
                  Get Started
                </Link>
                <Link
                  href="/auth/login"
                  className="px-8 py-3 rounded-lg border border-new-border text-white font-semibold hover:bg-new-box-hover transition-colors"
                >
                  Login
                </Link>
              </>
            ) : (
              <>
                <Link
                  href="/launches"
                  className="px-8 py-3 rounded-lg bg-new-btn-primary text-white font-semibold hover:bg-new-btn-primary/80 transition-colors"
                >
                  Go to Dashboard
                </Link>
              </>
            )}
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-new-bgColorInner">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl sm:text-4xl font-bold text-center mb-16">Features</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[
              {
                title: 'Connect Social Media Accounts',
                description: 'Securely connect your TikTok, Instagram, Twitter, and more using official platform APIs.',
              },
              {
                title: 'Schedule & Publish Content',
                description: 'Plan your content strategy and schedule posts across multiple platforms in advance.',
              },
              {
                title: 'Upload TikTok Videos',
                description: 'Upload and manage your TikTok videos directly from our dashboard.',
              },
              {
                title: 'Manage Campaigns',
                description: 'Organize and manage all your publishing workflows from one centralized dashboard.',
              },
              {
                title: 'Track Publishing Status',
                description: 'Monitor the status of your posts and get real-time updates on publishing.',
              },
              {
                title: 'Multi-Account Management',
                description: 'Manage multiple social media accounts and organize them by campaigns.',
              },
            ].map((feature, index) => (
              <div
                key={index}
                className="p-6 rounded-lg bg-new-bgColor border border-new-border hover:border-new-btn-primary/50 transition-all"
              >
                <h3 className="text-lg font-semibold mb-2">{feature.title}</h3>
                <p className="text-gray-400">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl sm:text-4xl font-bold text-center mb-16">How It Works</h2>
          <div className="space-y-8">
            {[
              {
                number: 1,
                title: 'Create an Account',
                description: 'Sign up with your email or social account to get started.',
              },
              {
                number: 2,
                title: 'Connect Your Social Profiles',
                description: 'Securely connect your TikTok and other social media accounts using official APIs.',
              },
              {
                number: 3,
                title: 'Upload Your Content',
                description: 'Upload videos, images, and create posts directly in the dashboard.',
              },
              {
                number: 4,
                title: 'Schedule or Publish Posts',
                description: 'Schedule your content for the future or publish it immediately across all platforms.',
              },
            ].map((step, index) => (
              <div key={index} className="flex gap-6">
                <div className="flex-shrink-0">
                  <div className="flex items-center justify-center h-12 w-12 rounded-lg bg-new-btn-primary">
                    <span className="text-white font-bold">{step.number}</span>
                  </div>
                </div>
                <div>
                  <h3 className="text-lg font-semibold mb-2">{step.title}</h3>
                  <p className="text-gray-400">{step.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Security & Privacy Section */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-new-bgColorInner">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl sm:text-4xl font-bold text-center mb-8">Security & Privacy</h2>
          <div className="bg-new-bgColor border border-new-border rounded-lg p-8 text-center">
            <p className="text-lg text-gray-300">
              TrendPostiz uses official platform APIs, including TikTok Login Kit, to securely connect user accounts. 
              Your data is encrypted and protected with industry-standard security measures.
            </p>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-bold mb-8">Ready to Get Started?</h2>
          <p className="text-xl text-gray-300 mb-8">Join creators and businesses using TrendPostiz to manage their social media.</p>
          {!isAuthenticated ? (
            <Link
              href="/auth/register"
              className="inline-block px-8 py-3 rounded-lg bg-new-btn-primary text-white font-semibold hover:bg-new-btn-primary/80 transition-colors"
            >
              Create Your Account
            </Link>
          ) : (
            <Link
              href="/launches"
              className="inline-block px-8 py-3 rounded-lg bg-new-btn-primary text-white font-semibold hover:bg-new-btn-primary/80 transition-colors"
            >
              View Dashboard
            </Link>
          )}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-new-border py-12 px-4 sm:px-6 lg:px-8 bg-new-bgColorInner">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
            <div>
              <h3 className="font-bold mb-4">TrendPostiz</h3>
              <p className="text-gray-400">Social media management for creators and businesses.</p>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Product</h4>
              <ul className="space-y-2 text-gray-400">
                <li>
                  <Link href="/auth/register" className="hover:text-white transition-colors">
                    Get Started
                  </Link>
                </li>
                <li>
                  <Link href="/auth/login" className="hover:text-white transition-colors">
                    Sign In
                  </Link>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Legal</h4>
              <ul className="space-y-2 text-gray-400">
                <li>
                  <Link href="/privacy" className="hover:text-white transition-colors">
                    Privacy Policy
                  </Link>
                </li>
                <li>
                  <Link href="/terms" className="hover:text-white transition-colors">
                    Terms of Service
                  </Link>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Support</h4>
              <ul className="space-y-2 text-gray-400">
                <li>
                  <a
                    href="mailto:support@trendpostiz.com.br"
                    className="hover:text-white transition-colors"
                  >
                    support@trendpostiz.com.br
                  </a>
                </li>
              </ul>
            </div>
          </div>
          <div className="border-t border-new-border pt-8 text-center text-gray-400">
            <p>&copy; 2026 TrendPostiz. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
