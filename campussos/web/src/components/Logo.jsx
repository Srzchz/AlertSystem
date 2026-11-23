import React from 'react';

export default function Logo({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 2l8 3v6c0 5-3.4 9.2-8 11-4.6-1.8-8-6-8-11V5l8-3z" fill="#1B651B" />
      <path d="M8.5 12.2l2.4 2.4 4.6-4.8" stroke="#FFD700" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
