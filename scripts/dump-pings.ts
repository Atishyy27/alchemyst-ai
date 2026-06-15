import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:4747/ws');

ws.on('open', () => {
  console.log('Connected to agent-server');
  // Trigger user message to start chaos
  ws.send(JSON.stringify({ type: 'USER_MESSAGE', content: 'hello' }));
});

let pings = 0;
ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.type === 'PING') {
    pings++;
    console.log(`PING ${pings}:`, JSON.stringify(msg));
    ws.send(JSON.stringify({ type: 'PONG', echo: msg.challenge }));
    if (pings >= 5) {
      process.exit(0);
    }
  }
});
