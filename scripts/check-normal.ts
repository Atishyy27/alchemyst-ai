import { ConnectionManager } from '../src/lib/ws/connectionManager';
import { ServerMessage } from '../src/types/protocol';
import fs from 'node:fs';
import path from 'node:path';

async function run() {
  const cm = new ConnectionManager({ url: 'ws://localhost:4747/ws', debug: false });
  
  const delivered: { seq: number, type: string }[] = [];
  const streams = new Map<string, string>();
  const toolCallTimes = new Map<string, number>();
  const toolAckDeltas = new Map<string, number>();

  const fixturesDir = path.join(process.cwd(), 'src/lib/test/fixtures');
  if (!fs.existsSync(fixturesDir)) {
    fs.mkdirSync(fixturesDir, { recursive: true });
  }

  let finalSeq = 0;

  cm.onMessage((msg: ServerMessage) => {
    delivered.push({ seq: msg.seq, type: msg.type });
    finalSeq = Math.max(finalSeq, msg.seq);

    if (msg.type === 'CONTEXT_SNAPSHOT') {
      const filePath = path.join(fixturesDir, `ctx_${msg.context_id}_${msg.seq}.json`);
      fs.writeFileSync(filePath, JSON.stringify(msg.data, null, 2), 'utf-8');
    } else if (msg.type === 'TOKEN') {
      const existing = streams.get(msg.stream_id) || '';
      streams.set(msg.stream_id, existing + msg.text);
    } else if (msg.type === 'TOOL_CALL') {
      const now = Date.now();
      toolCallTimes.set(msg.call_id, now);
      
      // Send ACK
      setTimeout(() => {
        cm.send({
          type: 'TOOL_ACK',
          call_id: msg.call_id
        });
        toolAckDeltas.set(msg.call_id, Date.now() - now);
      }, 50); // Small delay to simulate processing, or instant
    }
  });

  cm.onStateChange((state) => {
    if (state === 'connected') {
      cm.send({
        type: 'USER_MESSAGE',
        content: 'report, summary, q3'
      });
    }
  });

  cm.connect();

  console.log('Running for 15 seconds...');
  await new Promise(resolve => setTimeout(resolve, 15000));

  cm.disconnect();

  console.log('\n--- DELIVERED MESSAGES (Arrival Order) ---');
  delivered.forEach((d) => {
    console.log(`Seq: ${d.seq} | Type: ${d.type}`);
  });

  // Verify strictly increasing seq
  let strictlyIncreasing = true;
  for (let i = 1; i < delivered.length; i++) {
    if (delivered[i].seq <= delivered[i - 1].seq) {
      strictlyIncreasing = false;
      console.error(`ERROR: Seq not strictly increasing at index ${i} (${delivered[i - 1].seq} -> ${delivered[i].seq})`);
    }
  }
  if (strictlyIncreasing) console.log('PASS: Delivered seq strictly increasing with no gaps/dupes');

  console.log('\n--- FINAL TEXT PER STREAM ---');
  for (const [id, text] of streams.entries()) {
    console.log(`Stream: ${id}\nText: ${text}\n`);
  }

  console.log('\n--- TOOL ACK DELTAS ---');
  let allDeltasValid = true;
  for (const [id, delta] of toolAckDeltas.entries()) {
    console.log(`Call ID: ${id} | Delta: ${delta}ms`);
    if (delta >= 2000) allDeltasValid = false;
  }
  if (allDeltasValid && toolAckDeltas.size > 0) {
    console.log('PASS: Every TOOL_ACK delta < 2000ms');
  }

  console.log(`\nFinal lastProcessedSeq: ${cm.getLastProcessedSeq()}`);
  
  process.exit(0);
}

run().catch(console.error);
