// Use a shared useRef-based registry (module singleton) keyed by call_id/stream_id to avoid second state store rerenders

import { useAppStore } from '@/lib/store/appStore';

class HighlightRegistry {
  private highlightSubscribers = new Set<() => void>();
  public listRef: { scrollToRow: (args: { index: number; align: string }) => void } | null = null;
  private chatRefs = new Map<string, HTMLElement>();
  private timelineNodeRefs = new Map<string, HTMLElement>();

  registerChatRef(key: string, el: HTMLElement | null) {
    if (el) {
      this.chatRefs.set(key, el);
    } else {
      this.chatRefs.delete(key);
    }
  }

  registerTimelineNodeRef(key: string, el: HTMLElement | null) {
    if (el) {
      this.timelineNodeRefs.set(key, el);
    } else {
      this.timelineNodeRefs.delete(key);
    }
  }

  highlightChatText(firstSeq: number) {
    const el = this.chatRefs.get(`chat_seq_${firstSeq}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.setAttribute('data-highlighted', 'true');
      setTimeout(() => {
        el.removeAttribute('data-highlighted');
      }, 2000);
    }
  }

  highlightChatToolCall(callId: string) {
    const el = this.chatRefs.get(`chat_tool_${callId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.setAttribute('data-highlighted', 'true');
      setTimeout(() => {
        el.removeAttribute('data-highlighted');
      }, 2000);
    }
  }

  highlightTimelineToolCall(callId: string, timelineIndex: number) {
    if (this.listRef) {
      // Auto-unhide if filtered out
      const state = useAppStore.getState();
      if (!state.timelineFilter.showToolCalls || state.timelineFilter.searchQuery) {
        state.setTimelineFilter({ showToolCalls: true, searchQuery: '' });
      }
      if (state.activeTab !== 'timeline') {
        state.setActiveTab('timeline');
      }

      this.listRef.scrollToRow({ index: timelineIndex, align: 'center' });
      
      // We need to wait for react-window to render the row before we can highlight the DOM node
      setTimeout(() => {
        const el = this.timelineNodeRefs.get(`timeline_tool_${callId}`);
        if (el) {
          el.setAttribute('data-highlighted', 'true');
          setTimeout(() => el.removeAttribute('data-highlighted'), 2000);
        }
      }, 150);
    }
  }
}

export const highlightRegistry = new HighlightRegistry();
