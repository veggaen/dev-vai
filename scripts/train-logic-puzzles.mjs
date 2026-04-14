#!/usr/bin/env node
/**
 * VAI Logic Puzzles Training + Benchmark
 * 
 * Phase 1: Baseline benchmark (test before teaching)
 * Phase 2: Teach Vai all 20 core questions with verified answers
 * Phase 3: Generate & teach 50 follow-up questions (5 per core Q)
 * Phase 4: Post-training benchmark
 * Phase 5: Full test suite coordination
 * 
 * Usage: node scripts/train-logic-puzzles.mjs [--baseline | --train | --benchmark | --full]
 */
import WebSocket from 'ws';
import { writeFileSync, readFileSync, existsSync } from 'fs';

const BASE = 'http://localhost:3006';
const WS_URL = 'ws://localhost:3006/api/chat';
const RESULTS_FILE = './scripts/logic-puzzle-results.json';

// ── WebSocket Chat ──────────────────────────────────────────

function askVai(conversationId, question, timeoutMs = 25000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    let response = '';
    let gotDone = false;
    const start = Date.now();

    ws.on('open', () => {
      ws.send(JSON.stringify({ conversationId, content: question }));
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'text_delta' && msg.textDelta) response += msg.textDelta;
        if (msg.type === 'done') { gotDone = true; ws.close(); }
        if (msg.type === 'error') { ws.close(); resolve({ response: `[ERROR] ${msg.error}`, ms: Date.now() - start }); }
      } catch { /* ignore */ }
    });

    ws.on('close', () => resolve({ response: response || '[no response]', ms: Date.now() - start }));
    ws.on('error', (err) => resolve({ response: `[WS_ERROR] ${err.message}`, ms: Date.now() - start }));

    setTimeout(() => {
      if (!gotDone) { ws.terminate(); resolve({ response: response || '[TIMEOUT]', ms: Date.now() - start }); }
    }, timeoutMs);
  });
}

async function createConv(title) {
  const res = await fetch(`${BASE}/api/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, modelId: 'vai:v0' }),
  });
  return (await res.json()).id;
}

// ── Core Questions: 10 Misconception MCQs ──────────────────

const misconceptionQuestions = [
  {
    id: 'MC1',
    category: 'lateral-thinking',
    question: 'A puzzle: three light switches outside, three bulbs inside, enter once. What misconception makes people think this has no unique solution?',
    correctAnswer: 'D',
    options: {
      A: 'They assume they must see all bulbs lit at the same time',
      B: 'They assume the switches can only be flipped once',
      C: 'They assume each switch controls more than one bulb',
      D: 'They assume the bulbs behave ideally with no heating effects',
    },
    explanation: 'The solution uses heat: leave switch A on for minutes, turn it off, turn B on. Enter: lit=B, warm=A, cold=C. Ignoring that bulbs stay warm makes it seem unsolvable.',
    teachingText: 'The three light switches puzzle is solved by using heat as information. Leave switch A on for several minutes to heat its bulb, turn A off, turn B on, enter room. The lit bulb is B, the warm-but-off bulb is A, the cold bulb is C. The common misconception that blocks people is assuming bulbs behave ideally with no heating effects - they only think in on/off binary states and miss the tactile heat clue.',
  },
  {
    id: 'MC2',
    category: 'lateral-thinking',
    question: 'A man asks a bartender for water. The bartender pulls a gun. The man says "Thank you" and leaves. What mistaken assumption causes people to reject the unique solution?',
    correctAnswer: 'D',
    options: {
      A: 'They assume the gun must be real and loaded',
      B: 'They assume guns cannot be used as a nonverbal signal',
      C: 'They assume the man must receive water to be satisfied',
      D: 'They assume the bartender wants to harm the man',
    },
    explanation: 'The man had hiccups. The bartender scared him to cure them. Assuming hostile intent blocks seeing the benign solution.',
    teachingText: 'The bartender-gun-water puzzle: the man had hiccups and asked for water as a remedy. The bartender recognized this and used a more immediate cure - scaring him with a gun. The man says "Thank you" because his hiccups are gone. The key misconception is assuming the bartender wants to harm the man. Once you drop that assumption, the benign explanation is unique and coherent.',
  },
  {
    id: 'MC3',
    category: 'constraint-reasoning',
    question: 'Wolf, goat, cabbage river crossing puzzle. What misconception makes solvers think there is no unique sequence?',
    correctAnswer: 'B',
    options: {
      A: 'They assume the boat can carry two items',
      B: 'They assume the farmer can tether animals on the bank',
      C: 'They ignore symmetric variants and overcount',
      D: 'They treat each bank as independent',
    },
    explanation: 'Adding tethers relaxes constraints, making many sequences valid. Without them, only the canonical sequence works.',
    teachingText: 'The wolf-goat-cabbage river crossing puzzle has a unique solution sequence if you follow the stated rules strictly. The misconception is assuming the farmer can tether animals on the bank. Adding tethers breaks the core constraints (wolf cant be alone with goat, goat cant be alone with cabbage). Without tethers, the state space is constrained and only the canonical sequence works: take goat, return, take cabbage, bring goat back, take wolf, return, take goat.',
  },
  {
    id: 'MC4',
    category: 'formal-logic',
    question: 'Three suspects, three statements, exactly one is true. What misconception about "exactly one" causes people to miss the unique solution?',
    correctAnswer: 'B',
    options: {
      A: 'They ignore the possibility all statements could be false',
      B: 'They treat "exactly one" as "at least one"',
      C: 'They assume each suspect must be mentioned at least once',
      D: 'They assume truth values must alternate',
    },
    explanation: '"At least one" allows multiple true statements, creating multiple valid thief assignments. "Exactly one" is strictly one true, rest false.',
    teachingText: 'In logic puzzles with "exactly one statement is true", the key misconception is treating "exactly one" as "at least one". This allows multiple true statements, creating multiple valid solutions. Strict "exactly one" means precisely one true and all others false. When you enforce this, you eliminate all configurations with 0 or 2+ true statements, typically leaving only one consistent assignment that uniquely identifies the answer.',
  },
  {
    id: 'MC5',
    category: 'formal-logic',
    question: 'Wason card task: "If vowel on one side, then even number on other." What misconception leads people to flip the wrong cards?',
    correctAnswer: 'B',
    options: {
      A: 'They believe even numbers automatically guarantee vowels',
      B: 'They confuse "if" with "if and only if"',
      C: 'They assume vowels can only appear with certain consonants',
      D: 'They think you must confirm both sides of every card',
    },
    explanation: 'Treating the conditional as biconditional makes people check even-number cards unnecessarily. Only vowel + odd-number cards can falsify.',
    teachingText: 'In the Wason selection task with rule "if vowel then even number", the key misconception is confusing "if" with "if and only if". The conditional P→Q is only violated when P is true and Q is false (vowel paired with odd number). People who read it as biconditional incorrectly check even-number cards thinking even must imply vowel. The correct strategy: flip vowel cards and odd-number cards to look for counterexamples.',
  },
  {
    id: 'MC6',
    category: 'constraint-reasoning',
    question: 'KenKen/arithmetic puzzle guaranteed to have a unique solution. Why do some solvers claim multiple solutions exist?',
    correctAnswer: 'B',
    options: {
      A: 'They think any temporary assumption is an invalid guess',
      B: 'They believe uniqueness forbids branching reasoning entirely',
      C: 'They assume arithmetic operations in cages are optional hints',
      D: 'They confuse local uniqueness in a cage with global uniqueness',
    },
    explanation: 'Some solvers think branching = guessing and stop when single-step deduction runs out. But branching with contradiction elimination is valid deduction.',
    teachingText: 'In KenKen and similar constraint puzzles, the misconception is believing that uniqueness forbids branching reasoning entirely. Some solvers equate any "what if this cell is 2?" exploration with guessing, and think uniquely solvable puzzles should never require it. But systematic branching with contradiction elimination IS valid deduction (proof by contradiction). Only one branch survives full analysis. Stopping early because you refuse to branch leaves multiple incomplete patterns.',
  },
  {
    id: 'MC7',
    category: 'constraint-reasoning',
    question: 'Sudoku with unique solution. Some claim two symmetrical cells can take either value. What misconception about global constraints?',
    correctAnswer: 'B',
    options: {
      A: 'They assume each number appears independently in each row',
      B: 'They believe symmetry in candidates implies symmetry in full solutions',
      C: 'They treat subgrid constraints as weaker than row constraints',
      D: 'They think uniqueness guarantees every placement is forced locally',
    },
    explanation: 'Local candidate symmetry does not mean global solution symmetry. Distant constraints break apparent symmetries.',
    teachingText: 'In Sudoku, the misconception is believing that symmetry in candidates implies symmetry in full solutions. Two cells may look interchangeable at an intermediate stage (same candidates, same row/column), but distant constraints from other regions break this apparent symmetry. Uniqueness is a global property. Local candidate symmetry at one stage gets resolved by further deductions from intersecting rows, columns, and subgrids.',
  },
  {
    id: 'MC8',
    category: 'lateral-thinking',
    question: 'Woman lives on 10th floor, takes elevator to 7th and walks up 3 flights despite hating walking. What assumption blocks the answer?',
    correctAnswer: 'A',
    options: {
      A: 'They assume the elevator is always fully functional',
      B: 'They assume she enjoys exercise',
      C: 'They assume the building has external stairs only',
      D: 'They assume she is trying to save electricity',
    },
    explanation: 'She is short and cannot reach the 10th floor button. The elevator works, but not for HER to reach all buttons.',
    teachingText: 'The 10th floor elevator puzzle: the woman is short and cannot reach the button for floor 10, but can reach floor 7. She takes the elevator to 7 and walks the remaining 3 flights. The blocking assumption is that the elevator is always fully functional FOR HER. The hardware works fine, but she physically cannot press button 10. On rainy days she uses her umbrella to press it. This shows how assuming standard usability hides the constraint.',
  },
  {
    id: 'MC9',
    category: 'combinatorics',
    question: 'Round table seating puzzle. Some count rotations as different solutions. What misconception about equivalence?',
    correctAnswer: 'B',
    options: {
      A: 'They treat mirror images as identical but rotations as new',
      B: 'They confuse physical distinctness with logical distinctness',
      C: 'They believe names can be permuted without changing solutions',
      D: 'They assume only adjacent relationships matter',
    },
    explanation: 'Rotating everyone preserves all relational facts (who is next to whom). Rotated arrangements are the same logical solution.',
    teachingText: 'In round table seating puzzles, the misconception is confusing physical distinctness with logical distinctness. What matters are relational facts: who sits next to whom, opposite whom. Rotating the entire arrangement preserves ALL these relationships. So rotated versions are the same logical solution. Counting each rotated diagram as separate falsely inflates the solution count, making it seem non-unique when the designer intended one answer.',
  },
  {
    id: 'MC10',
    category: 'constraint-reasoning',
    question: 'Three boxes labeled wrong (apples, oranges, both). Sample once from one box. Why do people think more samples needed?',
    correctAnswer: 'D',
    options: {
      A: 'They think sampling one box cannot determine two others',
      B: 'They forget drawing from the "both" box is redundant',
      C: 'They assume the contents might change after drawing',
      D: 'They assume the incorrect labels give no useful information',
    },
    explanation: 'Wrong labels are constraints, not noise. Each wrong label eliminates one possibility. Combined with one sample, all three can be deduced.',
    teachingText: 'The three mislabeled boxes puzzle: every label is WRONG, which is a powerful constraint, not noise. Sample from the box labeled "apples and oranges" - it CANNOT contain both (label is wrong). If you draw an apple, that box is "only apples". The box labeled "oranges" cannot be oranges (wrong label) and cannot be apples (taken), so it must be "both". The remaining box is "oranges". The misconception is assuming the incorrect labels give no useful information - but wrong labels are structured elimination constraints.',
  },
];

// ── Core Questions: 10 Verbal Math / Logic Yes/No ──────────

const verbalMathQuestions = [
  {
    id: 'VM1',
    question: 'Simple verbal math: (3+3)=six. Is (2+2)=four? Answer yes or no.',
    correctAnswer: 'yes',
    validate: (r) => /\byes\b/i.test(r) && !/\bno\b/i.test(r.split('.')[0]),
    teachingText: 'In standard arithmetic, 2+2=4, spelled "four". This is basic addition with no trick. The answer is simply Yes. Common distractors like "fish" or "window" are wordplay that ignores actual mathematics.',
  },
  {
    id: 'VM2',
    question: 'Three switches puzzle: is it true that a bulb\'s residual heat distinguishes which switch controlled it?',
    correctAnswer: 'yes',
    validate: (r) => /\byes\b/i.test(r) || /\btrue\b/i.test(r) || /\bheat\b/i.test(r),
    teachingText: 'Yes, in the three light switch puzzle, heat from a recently-on bulb is the key distinguishing factor. Leave switch A on for minutes (heats bulb), turn off A, turn on B. Enter room: lit bulb=B, warm-but-off=A, cold=C. Heat is the third observable state beyond just on/off.',
  },
  {
    id: 'VM3',
    question: 'Verbal math: (7-3)=four. Is (5-2)=three?',
    correctAnswer: 'yes',
    validate: (r) => /\byes\b/i.test(r) && !/\bno\b/i.test(r.split('.')[0]),
    teachingText: 'Standard subtraction: 5-2=3, spelled "three". The answer is Yes. No wordplay tricks - this is straightforward arithmetic.',
  },
  {
    id: 'VM4',
    question: 'Bartender-gun-water puzzle: is it true that hiccups are cured by the scare?',
    correctAnswer: 'yes',
    validate: (r) => /\byes\b/i.test(r) || /\btrue\b/i.test(r) || /\bhiccup/i.test(r),
    teachingText: 'Yes. In the bartender-gun-water puzzle, the man had hiccups. He asked for water (one remedy), but the bartender chose a faster cure: scaring him with a gun. The startle response cured the hiccups, so the man said "Thank you" and left. The scare IS the cure.',
  },
  {
    id: 'VM5',
    question: 'Verbal math: (9-6)=three. Is (8-5)=three?',
    correctAnswer: 'yes',
    validate: (r) => /\byes\b/i.test(r) && !/\bno\b/i.test(r.split('.')[0]),
    teachingText: '8-5=3, spelled "three". Straightforward subtraction. Answer: Yes.',
  },
  {
    id: 'VM6',
    question: 'Wolf-goat-cabbage: does the sequence goat-first, return, wolf/cabbage, bring-goat-back work as the solution?',
    correctAnswer: 'yes',
    validate: (r) => /\byes\b/i.test(r) || /\bgoat\s*first/i.test(r) || /\bcorrect\b/i.test(r),
    teachingText: 'Yes. The canonical solution is: take goat across, return alone, take wolf (or cabbage) across, bring goat back, take cabbage (or wolf) across, return alone, take goat across. The goat must go first because it conflicts with both wolf and cabbage. This is the unique solution (up to wolf/cabbage order symmetry).',
  },
  {
    id: 'VM7',
    question: 'Verbal math: (1+7)=eight. Is (4+4)=eight?',
    correctAnswer: 'yes',
    validate: (r) => /\byes\b/i.test(r) && !/\bno\b/i.test(r.split('.')[0]),
    teachingText: '4+4=8, spelled "eight". Basic addition. Answer: Yes.',
  },
  {
    id: 'VM8',
    question: 'In a "exactly one statement is true" puzzle with three suspects, does enforcing the strict "exactly one" constraint (not "at least one") uniquely identify the thief?',
    correctAnswer: 'yes',
    validate: (r) => /\byes\b/i.test(r) || /\bunique/i.test(r) || /\bone\b.*\bthief\b/i.test(r),
    teachingText: 'Yes. When you strictly enforce "exactly one statement is true" (meaning precisely one true, all others false), you eliminate all configurations with 0 or 2+ true statements. This drastically narrows valid assignments, typically leaving only one consistent thief assignment. The key is not relaxing "exactly one" to "at least one".',
  },
  {
    id: 'VM9',
    question: 'Verbal math: (10-7)=three. Is (6-3)=three?',
    correctAnswer: 'yes',
    validate: (r) => /\byes\b/i.test(r) && !/\bno\b/i.test(r.split('.')[0]),
    teachingText: '6-3=3, spelled "three". Answer: Yes.',
  },
  {
    id: 'VM10',
    question: 'Wason card task: "if vowel then even." Does finding a vowel paired with an odd number falsify the rule?',
    correctAnswer: 'yes',
    validate: (r) => /\byes\b/i.test(r) || /\bfalsif/i.test(r) || /\bviolat/i.test(r) || /\bcounterexample/i.test(r),
    teachingText: 'Yes. The conditional "if vowel then even number" is violated exactly when the antecedent is true (vowel) and consequent is false (odd number). A vowel-odd pairing is a direct counterexample. This is why you should flip vowel cards and odd-number cards when testing the rule.',
  },
];

// ── Follow-up Generator ─────────────────────────────────────

function generateFollowUps(coreQ, vaiResponse) {
  const followUps = [];
  const cat = coreQ.category || 'logic';
  const id = coreQ.id;

  // Based on category, generate relevant follow-ups
  if (id.startsWith('MC1') || id === 'VM2') {
    followUps.push(
      { q: 'In the three switch puzzle, what are the THREE observable states when entering the room?', expected: 'lit, warm-off, cold', validate: (r) => /warm|hot|heat/i.test(r) && /lit|on|bright/i.test(r) },
      { q: 'Why is heat important in the three light bulb puzzle?', expected: 'creates third state', validate: (r) => /heat|warm|third|state|distinguish/i.test(r) },
      { q: 'If bulbs were LEDs that dont heat up, how many switches could you identify in one visit?', expected: '2 (on/off only)', validate: (r) => /\b2\b|two|only.*on.*off/i.test(r) },
      { q: 'What physical property of incandescent bulbs makes the three-switch puzzle solvable?', expected: 'thermal radiation/heat retention', validate: (r) => /heat|thermal|warm|temperature|incandescent/i.test(r) },
      { q: 'Step-by-step: how do you solve the 3 switches 3 bulbs puzzle?', expected: 'turn A on wait, off A, on B, enter', validate: (r) => /turn.*on|wait|warm|enter.*room|lit.*warm.*cold/i.test(r) },
    );
  } else if (id.startsWith('MC2') || id === 'VM4') {
    followUps.push(
      { q: 'Why does the man say "Thank you" after the bartender points a gun at him?', expected: 'hiccups cured', validate: (r) => /hiccup|cure|scare|grateful|thank/i.test(r) },
      { q: 'What did the man originally want the water for?', expected: 'to cure hiccups', validate: (r) => /hiccup|cure|remed/i.test(r) },
      { q: 'Is the bartender being hostile or helpful in the water-gun puzzle?', expected: 'helpful', validate: (r) => /helpful|help|benign|kind|assist/i.test(r) },
      { q: 'What other methods besides water and scaring can cure hiccups?', expected: 'holding breath, cold water, etc', validate: (r) => /breath|cold|sugar|pressure|diaphragm/i.test(r) },
      { q: 'What cognitive bias makes people misread the bartender puzzle?', expected: 'assuming hostile intent', validate: (r) => /hostil|violen|threat|harm|bias|assum/i.test(r) },
    );
  } else if (id.startsWith('MC3') || id === 'VM6') {
    followUps.push(
      { q: 'What must the farmer take across FIRST in the wolf-goat-cabbage puzzle?', expected: 'the goat', validate: (r) => /goat/i.test(r) },
      { q: 'Why cant the farmer take the wolf first in the river crossing?', expected: 'goat eats cabbage', validate: (r) => /goat.*cabbage|cabbage.*goat|eat/i.test(r) },
      { q: 'How many total river crossings does the wolf-goat-cabbage solution require?', expected: '7', validate: (r) => /\b7\b|seven/i.test(r) },
      { q: 'What makes the wolf-goat-cabbage puzzle a constraint satisfaction problem?', expected: 'forbidden pairings restrict state space', validate: (r) => /constraint|forbidden|restrict|state|pair/i.test(r) },
      { q: 'Which item does the farmer bring BACK across the river?', expected: 'the goat', validate: (r) => /goat/i.test(r) },
    );
  } else if (id.startsWith('MC4') || id === 'VM8') {
    followUps.push(
      { q: 'What is the difference between "exactly one" and "at least one" in logic?', expected: 'exactly one = one and only one; at least one = one or more', validate: (r) => /one\s+and\s+only|precise|strict|allow.*more|multiple/i.test(r) },
      { q: 'How many truth value combinations exist for 3 statements?', expected: '8 (2^3)', validate: (r) => /\b8\b|eight|2\^3|2\s*\*\*\s*3/i.test(r) },
      { q: 'If exactly one of three statements is true, how many valid truth-value assignments are there?', expected: '3', validate: (r) => /\b3\b|three/i.test(r) },
      { q: 'Why does "at least one" create ambiguity but "exactly one" doesnt?', expected: 'at least one allows 1,2,3 true; exactly one restricts to 1', validate: (r) => /multiple|ambig|allow|restrict|narrow/i.test(r) },
      { q: 'What logical quantifier does "exactly one" correspond to in formal logic?', expected: 'existential with uniqueness', validate: (r) => /unique|exist|∃!|exactly/i.test(r) },
    );
  } else if (id.startsWith('MC5') || id === 'VM10') {
    followUps.push(
      { q: 'In "if P then Q", what combination of P and Q makes the statement false?', expected: 'P true and Q false', validate: (r) => /P\s*true.*Q\s*false|true.*false|antecedent.*true.*consequent.*false/i.test(r) },
      { q: 'What is the contrapositive of "if vowel then even"?', expected: 'if not even (odd) then not vowel (consonant)', validate: (r) => /not\s*even|odd.*not.*vowel|consonant|contrapositive/i.test(r) },
      { q: 'Which two cards should you flip in the Wason task with vowel/even rule?', expected: 'the vowel card and the odd number card', validate: (r) => /vowel.*odd|odd.*vowel/i.test(r) },
      { q: 'Why is flipping the even-number card a waste in the Wason task?', expected: 'finding a consonant behind an even number does not violate the rule', validate: (r) => /consonant|does\s*n.t\s*violat|not.*violat|irrelevant|waste/i.test(r) },
      { q: 'What is the name of the fallacy where people confuse "if P then Q" with "if Q then P"?', expected: 'affirming the consequent', validate: (r) => /affirm.*consequent|converse\s*error|fallacy/i.test(r) },
    );
  } else if (id.startsWith('MC6')) {
    followUps.push(
      { q: 'Is proof by contradiction a valid deductive method in puzzles?', expected: 'yes', validate: (r) => /yes|valid|legitimate|correct|deduct/i.test(r) },
      { q: 'What is the difference between guessing and branching in puzzle solving?', expected: 'branching follows consequences systematically and eliminates contradictions', validate: (r) => /systemat|contradict|eliminat|consequen|follow/i.test(r) },
      { q: 'Why might a unique puzzle require branching to solve?', expected: 'single-step deduction may run out; branching reveals hidden contradictions', validate: (r) => /single.*step|run\s*out|hidden|contradict|branch/i.test(r) },
      { q: 'In KenKen, how do arithmetic cage constraints interact with row/column uniqueness?', expected: 'cage values must satisfy arithmetic AND each digit appears once per row/column', validate: (r) => /row|column|unique|arithmetic|cage|once/i.test(r) },
      { q: 'What happens when you explore a wrong branch in a constraint puzzle?', expected: 'you reach a contradiction and eliminate that branch', validate: (r) => /contradict|eliminat|impossible|dead\s*end|invalid/i.test(r) },
    );
  } else if (id.startsWith('MC7')) {
    followUps.push(
      { q: 'Can two Sudoku cells look interchangeable at an intermediate stage but have only one valid assignment?', expected: 'yes', validate: (r) => /yes|can|possible|true/i.test(r) },
      { q: 'What breaks apparent symmetry in Sudoku candidate lists?', expected: 'distant constraints from other rows/columns/subgrids', validate: (r) => /distant|other.*row|column|subgrid|propagat|constraint/i.test(r) },
      { q: 'Is uniqueness a local or global property of a Sudoku solution?', expected: 'global', validate: (r) => /global/i.test(r) },
      { q: 'What is constraint propagation in puzzle solving?', expected: 'when a value is placed, it eliminates possibilities in connected cells', validate: (r) => /eliminat|propagat|connected|reduc|possibilit/i.test(r) },
      { q: 'Why doesnt local candidate symmetry mean multiple solutions exist?', expected: 'because further constraints resolve the symmetry', validate: (r) => /further|resolv|break|constraint|distant|global/i.test(r) },
    );
  } else if (id.startsWith('MC8')) {
    followUps.push(
      { q: 'In the 10th floor elevator puzzle, why can the woman reach floor 7 but not floor 10?', expected: 'she is short; button 10 is too high', validate: (r) => /short|height|reach|too\s*high|button/i.test(r) },
      { q: 'On rainy days, the woman in the elevator puzzle goes directly to floor 10. Why?', expected: 'she uses her umbrella to press the higher button', validate: (r) => /umbrella|press|reach|tool/i.test(r) },
      { q: 'Why does the woman hate walking but still walk 3 flights?', expected: 'she has no choice; she cannot reach button 10', validate: (r) => /no\s*choice|can.t\s*reach|unable|force|only\s*option/i.test(r) },
      { q: 'What type of puzzle is the 10th floor elevator problem?', expected: 'lateral thinking puzzle', validate: (r) => /lateral|think|situati|riddle/i.test(r) },
      { q: 'What hidden constraint explains the womans elevator behavior?', expected: 'her height/physical limitation', validate: (r) => /height|short|physical|limitat|reach/i.test(r) },
    );
  } else if (id.startsWith('MC9')) {
    followUps.push(
      { q: 'In circular permutations, why are rotations considered equivalent?', expected: 'all relative positions stay the same', validate: (r) => /relative|same|preserv|position|relat/i.test(r) },
      { q: 'How many distinct circular arrangements of n people exist?', expected: '(n-1)!', validate: (r) => /\(n-1\)!|n.*minus.*1.*factorial|\(n\s*-\s*1\)/i.test(r) },
      { q: 'If 5 people sit at a round table, how many unique arrangements exist?', expected: '24 = 4!', validate: (r) => /24|4!|twenty.?four/i.test(r) },
      { q: 'What is the difference between linear and circular permutations?', expected: 'linear counts all orderings; circular divides by n (rotational equivalence)', validate: (r) => /divid|rotat|n|circular.*fewer|linear.*more/i.test(r) },
      { q: 'Are mirror images the same as rotations in round table problems?', expected: 'not necessarily; depends on whether seats are labeled or reflections are counted', validate: (r) => /depend|mirror|reflect|label|not\s*the\s*same|distinct/i.test(r) },
    );
  } else if (id.startsWith('MC10')) {
    followUps.push(
      { q: 'Which box should you sample from in the three mislabeled boxes puzzle?', expected: 'the box labeled "apples and oranges"', validate: (r) => /apples?\s*and\s*oranges|both|mixed|label/i.test(r) },
      { q: 'Why does sampling from the "apples and oranges" labeled box work?', expected: 'because it CANNOT contain both (label is wrong), so one fruit reveals its true content', validate: (r) => /cannot.*both|wrong.*label|one\s*fruit|reveal|eliminat/i.test(r) },
      { q: 'How many samples total are needed to correctly label all three boxes?', expected: '1', validate: (r) => /\b1\b|one|single/i.test(r) },
      { q: 'Are wrong labels constraints or noise in logic puzzles?', expected: 'constraints - they eliminate possibilities', validate: (r) => /constraint|eliminat|useful|information|structur/i.test(r) },
      { q: 'If you drew an orange from the box labeled "apples and oranges", what are the three correct labels?', expected: 'that box=oranges only, box labeled "oranges"=both, box labeled "apples"=apples only... wait, need to trace: "apples and oranges" box → drew orange → it is "only oranges". "Apples" label (wrong) → cannot be apples → must be "both". "Oranges" label (wrong) → cannot be oranges → must be "only apples".', validate: (r) => /orange.*only|both|apples\s*only/i.test(r) },
    );
  } else {
    // Generic follow-ups for verbal math
    followUps.push(
      { q: `Can you explain why ${coreQ.correctAnswer} is the right answer for: ${coreQ.question}`, expected: 'explanation', validate: (r) => r.length > 30 },
      { q: 'What is the most common mistake people make with this type of problem?', expected: 'overthinking', validate: (r) => r.length > 20 },
      { q: 'Give me a similar problem to the one we just discussed.', expected: 'similar problem', validate: (r) => r.length > 20 },
      { q: 'What category of reasoning does this problem test?', expected: 'arithmetic/logic', validate: (r) => /arith|logic|math|reason|deduct/i.test(r) },
      { q: 'Is this a trick question or straightforward?', expected: 'straightforward', validate: (r) => /straightforward|direct|simple|not.*trick/i.test(r) },
    );
  }

  return followUps.slice(0, 5);
}

// ── Benchmark Runner ────────────────────────────────────────

async function runBenchmark(label) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  BENCHMARK: ${label}`);
  console.log(`${'═'.repeat(60)}\n`);

  const convId = await createConv(`Benchmark: ${label}`);
  const results = { label, timestamp: new Date().toISOString(), scores: [], totalMs: 0 };
  let pass = 0, fail = 0;

  // Test misconception MCQs
  for (const q of misconceptionQuestions) {
    const prompt = `${q.question}\nA) ${q.options.A}\nB) ${q.options.B}\nC) ${q.options.C}\nD) ${q.options.D}\nAnswer with just the letter (A, B, C, or D).`;
    process.stdout.write(`  [${q.id}] `);
    const { response, ms } = await askVai(convId, prompt);
    results.totalMs += ms;

    // Check if correct letter appears
    const letterMatch = response.match(/\b([A-D])\b/);
    const answered = letterMatch ? letterMatch[1] : null;
    const correct = answered === q.correctAnswer;
    
    if (correct) { pass++; console.log(`✅ ${q.id} (${ms}ms)`); }
    else { fail++; console.log(`❌ ${q.id} — expected ${q.correctAnswer}, got ${answered || 'none'} (${ms}ms): ${response.slice(0, 80)}`); }
    
    results.scores.push({ id: q.id, correct, expected: q.correctAnswer, got: answered, ms, response: response.slice(0, 200) });
  }

  // Test verbal math
  for (const q of verbalMathQuestions) {
    process.stdout.write(`  [${q.id}] `);
    const { response, ms } = await askVai(convId, q.question);
    results.totalMs += ms;

    const correct = q.validate(response);
    if (correct) { pass++; console.log(`✅ ${q.id} (${ms}ms)`); }
    else { fail++; console.log(`❌ ${q.id} — expected ${q.correctAnswer} (${ms}ms): ${response.slice(0, 80)}`); }
    
    results.scores.push({ id: q.id, correct, expected: q.correctAnswer, ms, response: response.slice(0, 200) });
  }

  const pct = ((pass / (pass + fail)) * 100).toFixed(1);
  const avgMs = Math.round(results.totalMs / (pass + fail));
  
  console.log(`\n  ── RESULT: ${pass}/${pass + fail} (${pct}%) | avg ${avgMs}ms | total ${results.totalMs}ms ──\n`);
  
  results.pass = pass;
  results.fail = fail;
  results.pct = parseFloat(pct);
  results.avgMs = avgMs;
  return results;
}

// ── Training Phase ──────────────────────────────────────────

async function trainVai() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  TRAINING PHASE: Teaching Vai logic puzzles');
  console.log(`${'═'.repeat(60)}\n`);

  const convId = await createConv('Logic Puzzle Training Session');
  let taught = 0;

  // Teach misconception Q knowledge
  for (const q of misconceptionQuestions) {
    console.log(`  Teaching ${q.id}: ${q.category}...`);
    const { response, ms } = await askVai(convId, `I want to teach you about logic puzzles. ${q.teachingText}`);
    const learned = /learn|got it|absorb|remember|thank/i.test(response);
    console.log(`    ${learned ? '✅' : '⚠️'} ${ms}ms — ${response.slice(0, 80)}`);
    taught++;

    // Also teach via correction pattern for key facts
    if (q.correctAnswer && q.options) {
      const correctText = q.options[q.correctAnswer];
      const shortPattern = q.id.replace('MC', 'puzzle misconception ');
      const { response: r2 } = await askVai(convId, `Remember that ${shortPattern} answer is ${q.correctAnswer}: ${correctText}`);
      const ack = /learn|got it|remember/i.test(r2);
      if (ack) console.log(`    ✅ Correction registered`);
    }
  }

  // Teach verbal math knowledge  
  for (const q of verbalMathQuestions) {
    console.log(`  Teaching ${q.id}...`);
    const { response, ms } = await askVai(convId, `I want to teach you this: ${q.teachingText}`);
    const learned = /learn|got it|absorb|remember|thank/i.test(response);
    console.log(`    ${learned ? '✅' : '⚠️'} ${ms}ms — ${response.slice(0, 80)}`);
    taught++;
  }

  console.log(`\n  ── Taught ${taught} core knowledge items ──\n`);
  return taught;
}

// ── Follow-up Training ──────────────────────────────────────

async function trainFollowUps() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  FOLLOW-UP TRAINING: 50 generated questions');
  console.log(`${'═'.repeat(60)}\n`);

  const convId = await createConv('Follow-up Training');
  let total = 0, passed = 0;

  const allCoreQs = [...misconceptionQuestions, ...verbalMathQuestions];
  
  for (const coreQ of allCoreQs) {
    const followUps = generateFollowUps(coreQ, '');
    
    for (const fu of followUps) {
      total++;
      process.stdout.write(`  [${coreQ.id}-FU${total}] `);
      const { response, ms } = await askVai(convId, fu.q);
      const ok = fu.validate(response);
      
      if (ok) {
        passed++;
        console.log(`✅ (${ms}ms)`);
      } else {
        console.log(`❌ (${ms}ms) — teaching correction...`);
        // Teach the correct answer
        const { response: teachResp } = await askVai(convId, 
          `Actually, the correct answer to "${fu.q}" is: ${fu.expected}. Please remember this.`
        );
        console.log(`    Taught: ${teachResp.slice(0, 60)}`);
      }
    }
  }

  const pct = ((passed / total) * 100).toFixed(1);
  console.log(`\n  ── Follow-ups: ${passed}/${total} (${pct}%) correct before teaching ──\n`);
  return { total, passed, pct: parseFloat(pct) };
}

// ── Stats Tracker ───────────────────────────────────────────

function loadResults() {
  if (existsSync(RESULTS_FILE)) {
    return JSON.parse(readFileSync(RESULTS_FILE, 'utf-8'));
  }
  return { runs: [], summary: {} };
}

function saveResults(data) {
  writeFileSync(RESULTS_FILE, JSON.stringify(data, null, 2));
  console.log(`  📊 Results saved to ${RESULTS_FILE}`);
}

// ── Main ────────────────────────────────────────────────────

const mode = process.argv[2] || '--full';

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║   VAI LOGIC PUZZLES — Training & Benchmark Pipeline   ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  // Health check
  try {
    const h = await (await fetch(`${BASE}/health`)).json();
    console.log(`Server: vocab=${h.vocabSize?.toLocaleString()}, knowledge=${h.knowledgeEntries}, docs=${h.documentsIndexed}\n`);
  } catch {
    console.error('❌ Runtime not reachable. Start with: pnpm dev');
    process.exit(1);
  }

  const allResults = loadResults();

  // For full runs, clear stale taught entries to ensure deterministic results
  if (mode === '--full') {
    try {
      await fetch(`${BASE}/api/teach`, { method: 'DELETE' });
      console.log('🧹 Cleared stale taught entries for clean training run\n');
    } catch { /* ignore if endpoint unavailable */ }
  }

  if (mode === '--baseline' || mode === '--full') {
    const baseline = await runBenchmark('Baseline (pre-training)');
    allResults.runs.push(baseline);
    saveResults(allResults);
  }

  if (mode === '--train' || mode === '--full') {
    await trainVai();
    
    const postTrain = await runBenchmark('Post-Training #1');
    allResults.runs.push(postTrain);
    saveResults(allResults);

    await trainFollowUps();
    
    const postFollowUp = await runBenchmark('Post-Training + Follow-ups');
    allResults.runs.push(postFollowUp);
    saveResults(allResults);
  }

  if (mode === '--benchmark') {
    const bench = await runBenchmark(`Benchmark ${new Date().toISOString().slice(0,16)}`);
    allResults.runs.push(bench);
    saveResults(allResults);
  }

  // Print comparison
  if (allResults.runs.length > 1) {
    console.log('\n' + '═'.repeat(60));
    console.log('  PROGRESS COMPARISON');
    console.log('═'.repeat(60));
    for (const run of allResults.runs) {
      const bar = '█'.repeat(Math.round(run.pct / 5)) + '░'.repeat(20 - Math.round(run.pct / 5));
      console.log(`  ${run.label.padEnd(35)} ${bar} ${run.pct}% (${run.pass}/${run.pass + run.fail}) avg ${run.avgMs}ms`);
    }
    
    // Delta
    if (allResults.runs.length >= 2) {
      const first = allResults.runs[0];
      const last = allResults.runs[allResults.runs.length - 1];
      const delta = last.pct - first.pct;
      const speedDelta = last.avgMs - first.avgMs;
      console.log(`\n  Δ Quality: ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}% | Δ Speed: ${speedDelta >= 0 ? '+' : ''}${speedDelta}ms`);
    }
  }

  console.log('\n✅ Pipeline complete.\n');
}

main().catch(console.error);
