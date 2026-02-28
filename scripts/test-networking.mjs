/**
 * VAI OSI/TCP-IP Precision Benchmark — 33 Deterministic Networking Tests
 * ═══════════════════════════════════════════════════════════════════════
 * Subject: OSI Model + TCP/IP — Software/Programming focus
 * Audience: Senior+ Engineer level
 * 
 * Every answer is 100% verifiable against RFC standards, IEEE specs, or
 * universally accepted networking textbook facts.
 * 
 * Categories (max 4 per type, always rotating logic):
 *   osi-layers (4)    — Layer identification, PDUs, functions
 *   tcp-ip (4)        — TCP/IP model, mapping, protocols
 *   port-numbers (4)  — Well-known ports (RFC 6335)
 *   tcp-udp (4)       — TCP vs UDP, handshake, flags, MSS
 *   ip-addressing (4) — IPv4/IPv6 bits, subnetting, CIDR, classes
 *   dns (3)           — DNS acronym, records, TTL
 *   net-code (4)      — TCP server, UDP client, HTTP socket, socket concepts
 *   security (3)      — TLS layer, encryption types, handshake
 *   norwegian (3)     — Norwegian networking terminology
 * 
 * Confidence: 100% for all 33 tests — every answer is RFC-standard fact.
 * Any test that was 99% has been excluded.
 */
import WebSocket from 'ws';

const BASE_URL = 'http://localhost:3006';
const WS_URL = 'ws://localhost:3006/api/chat';

async function createConversation() {
  const res = await fetch(`${BASE_URL}/api/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelId: 'vai:v0', title: 'OSI/TCP-IP Benchmark' }),
  });
  const data = await res.json();
  return data.id;
}

// ── 33 Precision Tests ──────────────────────────────────────

const tests = [
  // ══════════════════════ OSI LAYERS (4) ══════════════════════
  {
    q: 'what are the 7 layers of the OSI model',
    cat: 'osi-layers',
    desc: 'List all 7 OSI layers with correct names and order',
    validate: (r) => {
      const lower = r.toLowerCase();
      // Must contain all 7 layer names
      return /physical/i.test(r) && /data\s*link/i.test(r) && /network/i.test(r) &&
        /transport/i.test(r) && /session/i.test(r) && /presentation/i.test(r) &&
        /application/i.test(r) &&
        // Must have correct numbering (1=Physical, 7=Application)
        /layer\s*1.*physical|physical.*layer\s*1|1.*physical/i.test(r) &&
        /layer\s*7.*application|application.*layer\s*7|7.*application/i.test(r);
    },
  },
  {
    q: 'what layer of the OSI model does HTTP operate on',
    cat: 'osi-layers',
    desc: 'HTTP operates at OSI Layer 7 (Application)',
    validate: (r) => /layer\s*7/i.test(r) && /application/i.test(r),
  },
  {
    q: 'which OSI layer handles encryption and data compression',
    cat: 'osi-layers',
    desc: 'Layer 6 (Presentation) handles encryption and compression',
    validate: (r) => /layer\s*6/i.test(r) && /presentation/i.test(r),
  },
  {
    q: 'what is the data unit called at layer 2 of the OSI model',
    cat: 'osi-layers',
    desc: 'Layer 2 PDU is a Frame',
    validate: (r) => /frame/i.test(r),
  },

  // ══════════════════════ TCP/IP MODEL (4) ══════════════════════
  {
    q: 'how many layers does the TCP/IP model have',
    cat: 'tcp-ip',
    desc: 'TCP/IP model has 4 layers',
    validate: (r) => /\b4\b/.test(r) && /layer/i.test(r),
  },
  {
    q: 'what are the 4 layers of the TCP/IP model',
    cat: 'tcp-ip',
    desc: 'Lists: Application, Transport, Internet, Network Access',
    validate: (r) => /application/i.test(r) && /transport/i.test(r) &&
      /internet/i.test(r) && /(?:network\s*access|link)/i.test(r),
  },
  {
    q: 'what is the difference between the OSI model and TCP/IP model',
    cat: 'tcp-ip',
    desc: 'OSI has 7 layers, TCP/IP has 4; OSI is theoretical, TCP/IP is practical',
    validate: (r) => /\b7\b/.test(r) && /\b4\b/.test(r) && /osi/i.test(r) && /tcp/i.test(r),
  },
  {
    q: 'which TCP/IP layer corresponds to OSI layers 5 6 and 7',
    cat: 'tcp-ip',
    desc: 'Application layer of TCP/IP maps to OSI 5, 6, 7',
    validate: (r) => /application/i.test(r),
  },

  // ══════════════════════ PORT NUMBERS (4) ══════════════════════
  {
    q: 'what is the default port number for HTTP',
    cat: 'port-numbers',
    desc: 'HTTP default port is 80',
    validate: (r) => /\b80\b/.test(r) && /http/i.test(r),
  },
  {
    q: 'what is the default port number for HTTPS',
    cat: 'port-numbers',
    desc: 'HTTPS default port is 443',
    validate: (r) => /\b443\b/.test(r),
  },
  {
    q: 'what is the default port number for SSH',
    cat: 'port-numbers',
    desc: 'SSH default port is 22',
    validate: (r) => /\b22\b/.test(r),
  },
  {
    q: 'what is the default port number for DNS',
    cat: 'port-numbers',
    desc: 'DNS default port is 53',
    validate: (r) => /\b53\b/.test(r),
  },

  // ══════════════════════ TCP vs UDP (4) ══════════════════════
  {
    q: 'what is the difference between TCP and UDP',
    cat: 'tcp-udp',
    desc: 'TCP is connection-oriented/reliable, UDP is connectionless/fast',
    validate: (r) => /connection/i.test(r) && /reliab/i.test(r) &&
      /tcp/i.test(r) && /udp/i.test(r),
  },
  {
    q: 'what is the TCP three-way handshake',
    cat: 'tcp-udp',
    desc: 'SYN → SYN-ACK → ACK sequence',
    validate: (r) => /syn/i.test(r) && /ack/i.test(r) &&
      (/syn.?ack/i.test(r) || /syn.*ack.*ack/i.test(r)),
  },
  {
    q: 'what are the TCP flags SYN ACK FIN RST',
    cat: 'tcp-udp',
    desc: 'Explains all 4 flags: SYN=synchronize, ACK=acknowledge, FIN=finish, RST=reset',
    validate: (r) => /syn/i.test(r) && /ack/i.test(r) && /fin/i.test(r) && /rst/i.test(r) &&
      /synchroni/i.test(r) && /acknowledg/i.test(r),
  },
  {
    q: 'what is the maximum size of a TCP segment',
    cat: 'tcp-udp',
    desc: 'MSS default 536, typical 1460 on Ethernet',
    validate: (r) => (/536/.test(r) || /1460/.test(r) || /mss/i.test(r)) && /tcp/i.test(r),
  },

  // ══════════════════════ IP ADDRESSING (4) ══════════════════════
  {
    q: 'how many bits in an IPv4 address',
    cat: 'ip-addressing',
    desc: 'IPv4 is 32 bits',
    validate: (r) => /\b32\b/.test(r) && /bit/i.test(r),
  },
  {
    q: 'how many bits in an IPv6 address',
    cat: 'ip-addressing',
    desc: 'IPv6 is 128 bits',
    validate: (r) => /\b128\b/.test(r) && /bit/i.test(r),
  },
  {
    q: 'what is the subnet mask for a /24 network',
    cat: 'ip-addressing',
    desc: 'Subnet mask is 255.255.255.0',
    validate: (r) => /255\.255\.255\.0/.test(r),
  },
  {
    q: 'how many usable hosts in a /24 subnet',
    cat: 'ip-addressing',
    desc: '/24 has 254 usable hosts (2^8 - 2)',
    validate: (r) => /\b254\b/.test(r),
  },

  // ══════════════════════ DNS (3) ══════════════════════
  {
    q: 'what does DNS stand for',
    cat: 'dns',
    desc: 'DNS = Domain Name System',
    validate: (r) => /domain\s*name\s*system/i.test(r),
  },
  {
    q: 'what is the difference between an A record and a CNAME record',
    cat: 'dns',
    desc: 'A record maps to IP, CNAME maps to another domain name',
    validate: (r) => /a\s*record/i.test(r) && /cname/i.test(r) &&
      (/ip\s*address/i.test(r) || /\d+\.\d+\.\d+\.\d+/.test(r)) &&
      (/alias/i.test(r) || /domain\s*name/i.test(r) || /another/i.test(r)),
  },
  {
    q: 'what is a DNS TTL',
    cat: 'dns',
    desc: 'TTL = Time to Live — cache duration for DNS records',
    validate: (r) => /time\s*to\s*live/i.test(r) && /cach/i.test(r),
  },

  // ══════════════════════ NETWORKING CODE (4) ══════════════════════
  {
    q: 'write a TCP server in Python that listens on port 8080',
    cat: 'net-code',
    desc: 'Python TCP server with socket, bind, listen, accept',
    validate: (r) => /socket/i.test(r) && /SOCK_STREAM/i.test(r) &&
      /bind/i.test(r) && /listen/i.test(r) && /accept/i.test(r) && /8080/.test(r),
  },
  {
    q: 'write a UDP client in Python that sends hello to localhost port 9000',
    cat: 'net-code',
    desc: 'Python UDP client with SOCK_DGRAM, sendto',
    validate: (r) => /socket/i.test(r) && /SOCK_DGRAM/i.test(r) &&
      /sendto/i.test(r) && /9000/.test(r),
  },
  {
    q: 'write a simple HTTP GET request using Python sockets',
    cat: 'net-code',
    desc: 'Raw HTTP GET over TCP socket — GET / HTTP/1.1',
    validate: (r) => /socket/i.test(r) && /GET/i.test(r) && /HTTP/i.test(r) &&
      /connect/i.test(r) && /send/i.test(r),
  },
  {
    q: 'what is the difference between blocking and non-blocking sockets',
    cat: 'net-code',
    desc: 'Blocking waits for data, non-blocking returns immediately',
    validate: (r) => /block/i.test(r) && /non.?block/i.test(r) &&
      (/wait/i.test(r) || /return/i.test(r)),
  },

  // ══════════════════════ SECURITY (3) ══════════════════════
  {
    q: 'what layer does TLS operate on',
    cat: 'security',
    desc: 'TLS at OSI Layer 6 (Presentation) / between Layer 4-7',
    validate: (r) => /layer\s*[4567]/i.test(r) && /tls/i.test(r),
  },
  {
    q: 'what is the difference between symmetric and asymmetric encryption',
    cat: 'security',
    desc: 'Symmetric = 1 key, fast; Asymmetric = 2 keys (public/private)',
    validate: (r) => /symmetric/i.test(r) && /asymmetric/i.test(r) &&
      (/1\s*(?:shared\s+)?key|one\s*key|single\s*key/i.test(r) || /shared/i.test(r)) &&
      (/2\s*keys|two\s*keys|public.*private|private.*public/i.test(r)),
  },
  {
    q: 'what is the TLS handshake process',
    cat: 'security',
    desc: 'TLS handshake: ClientHello → ServerHello → keys → encrypted',
    validate: (r) => /clienthello/i.test(r) && /serverhello/i.test(r) &&
      /cipher/i.test(r),
  },

  // ══════════════════════ NORWEGIAN (3) ══════════════════════
  {
    q: 'hva er de 7 lagene i OSI-modellen',
    cat: 'norwegian',
    desc: 'Lists 7 OSI layers in Norwegian (Lag 1-7)',
    validate: (r) => /lag\s*[17]/i.test(r) && /fysisk|physical/i.test(r) && /applikasjon|application/i.test(r),
  },
  {
    q: 'hva er forskjellen mellom TCP og UDP',
    cat: 'norwegian',
    desc: 'TCP vs UDP explained in Norwegian',
    validate: (r) => /tcp/i.test(r) && /udp/i.test(r) &&
      (/tilkobling/i.test(r) || /pålitelig/i.test(r) || /forbindelses/i.test(r) ||
       /connection/i.test(r)),
  },
  {
    q: 'hva betyr DNS',
    cat: 'norwegian',
    desc: 'DNS = Domain Name System (Norwegian explanation)',
    validate: (r) => /domain\s*name\s*system/i.test(r),
  },
];

// ── Test Runner ──

async function askVAI(conversationId, question) {
  return new Promise((resolve) => {
    const ws = new WebSocket(WS_URL);
    let fullResponse = '';
    const timeout = setTimeout(() => { ws.close(); resolve(fullResponse); }, 20000);

    ws.on('open', () => {
      ws.send(JSON.stringify({ conversationId, content: question }));
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'text_delta' && msg.textDelta) fullResponse += msg.textDelta;
        else if (msg.type === 'done') { clearTimeout(timeout); ws.close(); resolve(fullResponse.trim()); }
      } catch {}
    });

    ws.on('error', () => { clearTimeout(timeout); resolve(fullResponse); });
  });
}

async function waitForServer() {
  for (let i = 0; i < 30; i++) {
    try { const r = await fetch(`${BASE_URL}/health`); if (r.ok) return true; } catch {}
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║     VAI OSI/TCP-IP PRECISION BENCHMARK — 33 Tests    ║');
  console.log('║     Senior+ Engineer • 100% Deterministic Answers    ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  const ready = await waitForServer();
  if (!ready) { console.error('Server not available'); process.exit(1); }

  const stats = await (await fetch(`${BASE_URL}/health`)).json();
  console.log(`Server healthy — vocab: ${stats?.stats?.vocabSize}, knowledge: ${stats?.stats?.knowledgeEntries}\n`);

  const conversationId = await createConversation();
  console.log(`Conversation: ${conversationId}\n`);

  const results = { pass: 0, fail: 0, failures: [] };
  const catScores = {};

  for (let i = 0; i < tests.length; i++) {
    const t = tests[i];
    const label = `[${String(i + 1).padStart(2, '0')}/${tests.length}]`;

    const response = await askVAI(conversationId, t.q);
    const pass = t.validate(response);

    if (!catScores[t.cat]) catScores[t.cat] = { pass: 0, total: 0 };
    catScores[t.cat].total++;

    if (pass) {
      results.pass++;
      catScores[t.cat].pass++;
      console.log(`  ${label} ${t.desc.padEnd(65)} ✅ PASS`);
    } else {
      results.fail++;
      results.failures.push({ idx: i + 1, desc: t.desc, q: t.q, got: response.slice(0, 200) });
      console.log(`  ${label} ${t.desc.padEnd(65)} ❌ FAIL`);
    }

    await new Promise(r => setTimeout(r, 200));
  }

  // Scorecard
  console.log('\n' + '═'.repeat(60));
  console.log('                OSI/TCP-IP SCORECARD');
  console.log('═'.repeat(60));

  const cats = Object.keys(catScores).sort();
  for (const cat of cats) {
    const s = catScores[cat];
    const pct = Math.round((s.pass / s.total) * 100);
    const bar = '█'.repeat(Math.round(pct / 5));
    const icon = pct === 100 ? '🟢' : pct >= 50 ? '🟡' : '🔴';
    console.log(`  ${icon} ${cat.padEnd(16)} ${bar.padEnd(20)} ${s.pass}/${s.total} (${pct}%)`);
  }

  console.log('\n' + '─'.repeat(60));
  console.log(`  TOTAL:  ${results.pass}/${tests.length}  (${Math.round((results.pass / tests.length) * 100)}%)`);
  console.log('─'.repeat(60));

  if (results.failures.length > 0) {
    console.log('\n  FAILURES:');
    for (const f of results.failures) {
      console.log(`\n    • [${f.desc}]`);
      console.log(`      Q: ${f.q}`);
      console.log(`      Got: ${f.got}...`);
    }
  }

  if (results.pass === tests.length) {
    console.log('\n  🏆 PERFECT SCORE — 33/33 OSI/TCP-IP precision tasks correct!\n');
  }

  process.exit(results.fail > 0 ? 1 : 0);
}

main().catch(console.error);
