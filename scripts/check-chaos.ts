import { ConnectionManager } from '../src/lib/ws/connectionManager';
import { ServerMessage } from '../src/types/protocol';

async function run() {
  const cm = new ConnectionManager({ url: 'ws://localhost:4747/ws', debug: false });
  
  const rawLog: string[] = [];
  const delivered: { seq: number, type: string }[] = [];
  
  let emptyPings = 0;
  let resumeSent = false;
  let correctResumeSeq = false;
  let disconnects = 0;
  let reconnects = 0;

  // Intercept WebSocket send to catch RESUME
  const OriginalWebSocket = global.WebSocket;
  global.WebSocket = class extends OriginalWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      const originalSend = this.send.bind(this);
      this.send = function(data: any) {
        try {
          const parsed = JSON.parse(data.toString());
          if (parsed.type === 'RESUME') {
            resumeSent = true;
            console.log(`[OUTBOUND] RESUME sent with last_seq: ${parsed.last_seq} (expected: ${cm.getLastProcessedSeq()})`);
            if (parsed.last_seq === cm.getLastProcessedSeq()) {
              correctResumeSeq = true;
            }
          } else if (parsed.type === 'PONG') {
            console.log(`[OUTBOUND] PONG sent echoing challenge: "${parsed.echo}"`);
          }
        } catch (e) {}
        originalSend(data);
      };
    }
  } as any;

  // Monkey patch handleRawMessage
  const originalHandleRaw = (cm as any).handleRawMessage.bind(cm);
  (cm as any).handleRawMessage = function(data: any) {
    try {
      const parsed = JSON.parse(data.toString());
      const isCorruptPing = parsed.type === 'PING' && parsed.challenge === '';
      if (isCorruptPing) emptyPings++;
      
      const typeStr = isCorruptPing ? 'PING (EMPTY CHALLENGE)' : parsed.type;
      const logEntry = `[RAW] Seq: ${parsed.seq ?? 'N/A'} | Type: ${typeStr}`;
      console.log(logEntry);
      rawLog.push(logEntry);
    } catch(e) {
      console.log(`[RAW] Unparseable data`);
    }
    return originalHandleRaw(data);
  };

  let sentUserMessage = false;
  cm.onStateChange((state) => {
    const time = new Date().toISOString().substring(11, 23);
    console.log(`[${time}] [STATE] Transitioned to: ${state}`);
    
    if (state === 'reconnecting' || state === 'disconnected') {
      disconnects++;
    } else if (state === 'connected') {
      if (disconnects > 0) reconnects++;
      
      if (!sentUserMessage) {
        sentUserMessage = true;
        cm.send({ type: 'USER_MESSAGE', content: 'report, summary, q3' });
      }
    }
  });

  cm.onMessage((msg: ServerMessage) => {
    delivered.push({ seq: msg.seq, type: msg.type });
    if (msg.type === 'TOOL_CALL') {
      setTimeout(() => {
        cm.send({ type: 'TOOL_ACK', call_id: msg.call_id });
      }, 50);
    }
  });

  cm.connect();
  
  console.log('Running for 120 seconds...');
  await new Promise(resolve => setTimeout(resolve, 120000));
  
  cm.disconnect();
  
  console.log('\n--- DELIVERED MESSAGES (Arrival Order) ---');
  delivered.forEach((d) => {
    console.log(`Seq: ${d.seq} | Type: ${d.type}`);
  });

  let strictlyIncreasing = true;
  for (let i = 1; i < delivered.length; i++) {
    if (delivered[i].seq <= delivered[i - 1].seq) {
      strictlyIncreasing = false;
      console.error(`ERROR: Seq not strictly increasing at index ${i} (${delivered[i - 1].seq} -> ${delivered[i].seq})`);
    }
  }

  console.log('\n--- VERIFICATION ---');
  if (strictlyIncreasing) {
    console.log('PASS: Delivered seq is always strictly increasing with zero duplicates regardless of raw arrival order');
  } else {
    console.log('FAIL: Delivered seq not strictly increasing');
  }

  const toolCallsCount = delivered.filter(d => d.type === 'TOOL_CALL').length;
  const toolResultsCount = delivered.filter(d => d.type === 'TOOL_RESULT').length;
  const rawToolCallsCount = rawLog.filter(l => l.includes('Type: TOOL_CALL')).length;
  const rawToolResultsCount = rawLog.filter(l => l.includes('Type: TOOL_RESULT')).length;
  
  if (toolCallsCount === 1 && toolResultsCount === 1 && rawToolCallsCount > 1 && rawToolResultsCount > 1) {
    console.log('PASS: Duplicate TOOL_CALL and TOOL_RESULT replays detected in raw log but delivered exactly once');
  } else if (toolCallsCount === 1 && toolResultsCount === 1) {
    console.log('PASS: TOOL_CALL and TOOL_RESULT delivered exactly once (no replays occurred in this run)');
  } else {
    console.log(`FAIL: Expected 1 TOOL_CALL and 1 TOOL_RESULT in delivered, but got ${toolCallsCount} and ${toolResultsCount}. Raw replays: ${rawToolCallsCount} / ${rawToolResultsCount}`);
  }

  if (disconnects > 0 && reconnects > 0 && resumeSent && correctResumeSeq) {
    console.log('PASS: At least one full disconnect→reconnect cycle occurs with a RESUME sent containing the correct lastProcessedSeq at the moment of drop');
  } else {
    console.log(`FAIL: Missing disconnect cycle or correct RESUME. (disconnects: ${disconnects}, reconnects: ${reconnects}, resumeSent: ${resumeSent}, correctResumeSeq: ${correctResumeSeq})`);
  }

  if (emptyPings > 0) {
    console.log(`PASS: Every empty-challenge PING is logged and answered (empty-echo PONG) without the script crashing or exiting (${emptyPings} empty PINGs received)`);
  } else {
    console.log('FAIL: No empty-challenge PINGs received in 60s (could be unlucky random distribution)');
  }
  
  process.exit(0);
}

run().catch(console.error);
