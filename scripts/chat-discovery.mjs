/**
 * VAI Discovery Chat — 50 questions about OSI/TCP-IP models + networking programming
 * Purpose: Map what VAI knows vs doesn't know before building precision benchmark
 */
import WebSocket from 'ws';

const BASE_URL = 'http://localhost:3006';
const WS_URL = 'ws://localhost:3006/api/chat';

const questions = [
  // === OSI MODEL LAYERS (7 layers) ===
  "what are the 7 layers of the OSI model",
  "what layer of the OSI model does HTTP operate on",
  "what is the difference between layer 2 and layer 3 of the OSI model",
  "which OSI layer handles encryption and data compression",
  "what protocols operate at the transport layer of the OSI model",
  "what is the data unit called at layer 2 of the OSI model",
  "what is the purpose of the session layer in the OSI model",
  "name 3 protocols that operate at the network layer",

  // === TCP/IP MODEL ===
  "how many layers does the TCP/IP model have",
  "what are the 4 layers of the TCP/IP model",
  "what is the difference between the OSI model and TCP/IP model",
  "which TCP/IP layer corresponds to OSI layers 5 6 and 7",
  "what layer does ARP operate on in the TCP/IP model",

  // === TCP vs UDP ===
  "what is the difference between TCP and UDP",
  "what is the TCP three-way handshake",
  "what are the TCP flags SYN ACK FIN RST",
  "what is the default port number for HTTP",
  "what is the default port number for HTTPS",
  "what is the default port number for SSH",
  "what is the default port number for DNS",
  "what is the maximum size of a TCP segment",

  // === IP ADDRESSING ===
  "how many bits in an IPv4 address",
  "how many bits in an IPv6 address",
  "what is the subnet mask for a /24 network",
  "what is the broadcast address for 192.168.1.0/24",
  "what class is the IP address 172.16.0.1",
  "what is the loopback address in IPv4",

  // === DNS ===
  "what does DNS stand for",
  "what port does DNS use",
  "what is the difference between an A record and a CNAME record",
  "what is a DNS TTL",

  // === NETWORKING PROGRAMMING ===
  "write a TCP server in Python that listens on port 8080",
  "write a UDP client in Python that sends hello to localhost port 9000",
  "write a simple HTTP GET request using Python sockets",
  "what is a socket in networking programming",
  "what is the difference between blocking and non-blocking sockets",

  // === NETWORK MATH ===
  "how many usable hosts in a /24 subnet",
  "how many subnets can you create from a /16 with /24 subnets",
  "convert 192.168.1.1 to binary",
  "what is the binary representation of subnet mask 255.255.255.0",

  // === SECURITY / TLS ===
  "what layer does TLS operate on",
  "what is the TLS handshake process",
  "what is the difference between symmetric and asymmetric encryption",

  // === NORWEGIAN NETWORKING TERMINOLOGY ===
  "hva er de 7 lagene i OSI-modellen",
  "hva er forskjellen mellom TCP og UDP",
  "hva betyr DNS",
  "hva er en IP-adresse",
  "hva er standardporten for HTTP",

  // === ADVANCED CONCEPTS ===
  "what is NAT and how does it work",
  "what is the MTU for ethernet",
  "what is a VLAN",
];

async function waitForServer() {
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(`${BASE_URL}/health`);
      if (r.ok) return true;
    } catch {}
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}

async function askVAI(conversationId, question, idx) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    let fullResponse = '';
    const timeout = setTimeout(() => {
      ws.close();
      resolve({ question, response: fullResponse || '[TIMEOUT - no response]', idx });
    }, 15000);

    ws.on('open', () => {
      ws.send(JSON.stringify({
        conversationId,
        content: question,
      }));
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'text_delta' && msg.textDelta) {
          fullResponse += msg.textDelta;
        } else if (msg.type === 'done') {
          clearTimeout(timeout);
          ws.close();
          resolve({ question, response: fullResponse.trim(), idx });
        }
      } catch {}
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      resolve({ question, response: `[ERROR: ${err.message}]`, idx });
    });
  });
}

import { writeFileSync } from 'fs';

async function main() {
  const log = [];
  const out = (s) => { console.log(s); log.push(s); };
  
  out('╔════════════════════════════════════════════════════════╗');
  out('║   VAI DISCOVERY CHAT — 50 OSI/TCP-IP Questions       ║');
  out('╚════════════════════════════════════════════════════════╝\n');

  const ready = await waitForServer();
  if (!ready) { console.error('Server not ready'); process.exit(1); }
  out('Server healthy\n');

  // Create conversation
  const convRes = await fetch(`${BASE_URL}/api/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelId: 'vai:v0', title: 'discovery-chat' }),
  });
  const conv = await convRes.json();
  out(`Conversation: ${conv.id}\n`);

  const results = [];
  let knows = 0, doesntKnow = 0, partial = 0;

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    process.stdout.write(`  [${String(i+1).padStart(2, '0')}/${questions.length}] ${q.slice(0, 60).padEnd(62)}`);

    const result = await askVAI(conv.id, q, i);
    results.push(result);

    // Classify response
    const r = result.response.toLowerCase();
    const isIDontKnow = r.includes("don't have") || r.includes("don't know") || r.includes("still learning") ||
                        r.includes("teach me") || r.includes("no knowledge") || r.includes("helpful fallback") ||
                        r.includes("haven't learned") || r.includes("capture web pages");
    const isLearned = r.includes("i've learned") || r.includes("i'll remember");
    const isEmpty = result.response.length < 10;

    if (isIDontKnow || isEmpty || isLearned) {
      doesntKnow++;
      const label = '❌ NO KNOWLEDGE';
      console.log(label);
      log.push(`  [${String(i+1).padStart(2, '0')}/${questions.length}] ${q} → ${label}`);
    } else if (result.response.length < 80) {
      partial++;
      const label = '⚠️  PARTIAL';
      console.log(label);
      log.push(`  [${String(i+1).padStart(2, '0')}/${questions.length}] ${q} → ${label}`);
    } else {
      knows++;
      const label = '✅ HAS KNOWLEDGE';
      console.log(label);
      log.push(`  [${String(i+1).padStart(2, '0')}/${questions.length}] ${q} → ${label}`);
    }

    // Small delay between questions
    await new Promise(r => setTimeout(r, 300));
  }

  // Summary
  out('\n' + '═'.repeat(60));
  out('                   DISCOVERY SUMMARY');
  out('═'.repeat(60));
  out(`  ✅ HAS KNOWLEDGE:  ${knows}/${questions.length}`);
  out(`  ⚠️  PARTIAL:        ${partial}/${questions.length}`);
  out(`  ❌ NO KNOWLEDGE:   ${doesntKnow}/${questions.length}`);
  out('═'.repeat(60));

  // Print detailed results
  out('\n' + '═'.repeat(60));
  out('                   DETAILED RESPONSES');
  out('═'.repeat(60));

  for (const r of results) {
    out(`\n[Q${String(r.idx+1).padStart(2,'0')}] ${r.question}`);
    out(`[A] ${r.response.slice(0, 500)}`);
    if (r.response.length > 500) out(`  ... (${r.response.length} chars total)`);
    out('─'.repeat(60));
  }

  // Write to file
  writeFileSync('scripts/discovery-results.txt', log.join('\n'), 'utf-8');
  out('\nResults written to scripts/discovery-results.txt');
}

main().catch(console.error);
