import { useId } from 'react';
import type { SocialProvider } from '../lib/socialLogin';

export default function SocialProviderIcon({ provider, className = 'h-5 w-5' }: { provider: SocialProvider; className?: string }) {
  const maskId = useId();
  if (provider === 'wechat_scan') {
    return <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <defs><mask id={maskId}>
        <rect width="24" height="24" fill="white" />
        <circle cx="6.8" cy="8" r="0.9" fill="black" /><circle cx="11.8" cy="8" r="0.9" fill="black" />
        <path d="M22.5 14.8c0 3.4-3.4 6.2-7.5 6.2s-7.5-2.8-7.5-6.2 3.4-6.2 7.5-6.2 7.5 2.8 7.5 6.2Z" fill="black" stroke="black" strokeWidth="2" />
      </mask></defs>
      <path d="M17.5 9c0 3.9-3.6 7-8 7-1 0-2-.2-2.9-.5L3 17l.9-3A6.6 6.6 0 0 1 1.5 9c0-3.9 3.6-7 8-7s8 3.1 8 7Z" mask={`url(#${maskId})`} />
      <path fillRule="evenodd" d="M22 14.8c0 3.1-3.1 5.6-7 5.6-.8 0-1.6-.1-2.3-.3L9.5 21l.8-2.4a5.2 5.2 0 0 1-2.3-3.8c0-3.1 3.1-5.6 7-5.6s7 2.5 7 5.6Zm-10-1.2a.8.8 0 1 0 1.6 0 .8.8 0 0 0-1.6 0Zm5 0a.8.8 0 1 0 1.6 0 .8.8 0 0 0-1.6 0Z" />
    </svg>;
  }
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6.5 11.5C6 6 8 2.5 12 2.5S18 6 17.5 11.5c1.8 2 2.6 4.8 2 5.5-.5.5-1.4-.3-2.1-1.2-.7 3-2.6 4.5-5.4 4.5s-4.7-1.5-5.4-4.5c-.7.9-1.6 1.7-2.1 1.2-.6-.7.2-3.5 2-5.5Z" />
    <ellipse cx="12" cy="14.5" rx="3.7" ry="4.5" />
    <path d="m9.3 8.2.1-.1m5.2.1.1-.1M10.7 9.5h2.6L12 10.8ZM8 19.5l-2 1.8h4m6-1.8 2 1.8h-4" />
    <path d="M6.8 11.1c3.4 1.3 7 1.3 10.4 0" strokeWidth="2.4" />
  </svg>;
}
