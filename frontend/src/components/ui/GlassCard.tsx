import React from 'react';

interface GlassCardProps {
  children: React.ReactNode;
  className?: string;
  hoverEffect?: boolean;
  onClick?: () => void;
}

export function GlassCard({
  children,
  className = '',
  hoverEffect = false,
  onClick,
}: GlassCardProps) {
  return (
    <div
      onClick={onClick}
      className={`glass-panel rounded-2xl p-6 ${
        hoverEffect ? 'glass-panel-hover cursor-pointer' : ''
      } ${className}`}
    >
      {children}
    </div>
  );
}
