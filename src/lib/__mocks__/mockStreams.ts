import { ServerMessage } from '@/types/protocol';

export const mockStreams = {
  sequenceB: (): ServerMessage[] => [
    { type: 'TOKEN', stream_id: 's1', seq: 1, text: 'Hello' },
    { type: 'TOKEN', stream_id: 's1', seq: 2, text: ' world' },
    { type: 'TOOL_CALL', stream_id: 's1', seq: 3, call_id: 'tc1', tool_name: 'test', args: {} },
    { type: 'TOKEN', stream_id: 's1', seq: 4, text: ' I' },
    { type: 'TOKEN', stream_id: 's1', seq: 5, text: ' am' },
    { type: 'TOKEN', stream_id: 's1', seq: 6, text: ' AI' },
    { type: 'STREAM_END', stream_id: 's1', seq: 7 }
  ],
  sequenceD: (): ServerMessage[] => [
    { type: 'CONTEXT_SNAPSHOT', context_id: 'ctx1', seq: 1, data: { test: 123 } },
    { type: 'TOKEN', stream_id: 's1', seq: 2, text: 'First ' },
    { type: 'TOKEN', stream_id: 's1', seq: 3, text: 'text.' },
    { type: 'TOOL_CALL', stream_id: 's1', seq: 4, call_id: 'tc1', tool_name: 'get_weather', args: { loc: 'NY' } },
    { type: 'TOOL_RESULT', stream_id: 's1', seq: 5, call_id: 'tc1', result: { temp: 20 } },
    { type: 'TOKEN', stream_id: 's1', seq: 6, text: ' Second ' },
    { type: 'TOKEN', stream_id: 's1', seq: 7, text: 'text.' },
    { type: 'STREAM_END', stream_id: 's1', seq: 8 }
  ],
  largeTimeline: (n: number): ServerMessage[] => {
    const messages: ServerMessage[] = [];
    for (let i = 0; i < n; i++) {
      const type = i % 3;
      if (type === 0) {
        messages.push({
          type: 'TOKEN',
          seq: i + 1,
          stream_id: `stream_${i}`,
          text: `Message ${i}`
        });
        messages.push({
          type: 'STREAM_END',
          seq: i + 2,
          stream_id: `stream_${i}`
        });
      } else if (type === 1) {
        messages.push({
          type: 'TOOL_CALL',
          seq: i + 1,
          stream_id: `stream_${i}`,
          call_id: `call_${i}`,
          tool_name: 'test_tool',
          args: { id: i }
        });
      } else {
        messages.push({
          type: 'CONTEXT_SNAPSHOT',
          seq: i + 1,
          context_id: `ctx_${i}`,
          data: { test: true }
        });
      }
    }
    return messages;
  }
};
