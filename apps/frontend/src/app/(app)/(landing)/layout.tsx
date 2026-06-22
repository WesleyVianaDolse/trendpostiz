import { ReactNode } from 'react';
import { Plus_Jakarta_Sans } from 'next/font/google';

const jakartaSans = Plus_Jakarta_Sans({
  weight: ['600', '500'],
  style: ['normal', 'italic'],
  subsets: ['latin'],
});

/**
 * Layout para página pública de landing
 * Sem componentes de autenticação ou dados protegidos
 */
export default function LandingLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <>{children}</>;
}
