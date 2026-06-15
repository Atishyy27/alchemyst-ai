import React from 'react';
import { highlightRegistry } from '@/lib/highlightRegistry';

interface StreamingTextProps {
  content: string;
  firstSeq?: number;
}

export function StreamingText({ content, firstSeq }: StreamingTextProps) {
  // Renders the text content. We can replace this with a full markdown renderer later.
  return (
    <div 
      className="block flex-none transition-colors duration-300 whitespace-pre-wrap font-sans text-[15px] leading-relaxed data-[highlighted=true]:bg-yellow-200"
      ref={el => {
        if (firstSeq) {
          highlightRegistry.registerChatRef(`chat_seq_${firstSeq}`, el);
        }
      }}
    >
      {content}
    </div>
  );
}
