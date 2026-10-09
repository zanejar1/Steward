import type { Metadata } from 'next';
import './globals.css';
import { StewardProvider } from '@/components/store';
import { Shell } from '@/components/shell';
export const metadata: Metadata = { title: 'Steward — Expense workspace', description: 'Business expense governance on Stellar testnet.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body><StewardProvider><Shell>{children}</Shell></StewardProvider></body></html>; }
