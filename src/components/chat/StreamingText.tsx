import React from 'react';

interface StreamingTextProps {
  content: string;
}

export function StreamingText({ content }: StreamingTextProps) {
  // Renders the text content. We can replace this with a full markdown renderer later.
  return (
    <span className="whitespace-pre-wrap font-sans text-[15px] leading-relaxed">
      {content}
    </span>
  );
}
