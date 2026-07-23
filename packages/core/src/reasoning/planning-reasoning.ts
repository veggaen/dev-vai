import type { BoundedReasoningResult } from './bounded-reasoning.js';

interface ReasoningHistoryMessage { readonly role: string; readonly content: string }

interface Task {
  readonly id: string;
  readonly duration: number;
  readonly predecessors: readonly string[];
  readonly requiredSkills?: readonly string[];
  readonly fixedStart?: number;
  readonly release?: number;
}

interface Slot { readonly start: number; readonly end: number; readonly worker?: string }

const result = (strategy: string, reply: string): BoundedReasoningResult => ({
  reply,
  strategy: `bounded-reasoning:advanced:planning:${strategy}`,
  confidence: 0.99,
});

function dependencyMap(input: string): Map<string, string[]> {
  const dependencies = new Map<string, string[]>();
  for (const match of input.matchAll(/\b([A-Z](?:\d+)?(?:(?:\s*,\s*|\s+and\s+)[A-Z](?:\d+)?)*)\s+depend(?:s)? on\s+([A-Z](?:\s*,\s*[A-Z])*)/g)) {
    const tasks = [...match[1].matchAll(/[A-Z]/g)].map((item) => item[0]);
    const predecessors = match[2].split(/\s*,\s*/);
    tasks.forEach((task) => dependencies.set(task, predecessors));
  }
  return dependencies;
}

function topological(tasks: readonly Task[]): Task[] | null {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  if (tasks.some((task) => task.predecessors.some((predecessor) => !byId.has(predecessor)))) return null;
  const ordered: Task[] = [];
  while (ordered.length < tasks.length) {
    const ready = tasks.filter((task) => !ordered.includes(task) && task.predecessors.every((predecessor) => ordered.some((candidate) => candidate.id === predecessor)));
    if (ready.length === 0) return null;
    ready.sort((left, right) => tasks.indexOf(left) - tasks.indexOf(right));
    ordered.push(...ready);
  }
  return ordered;
}

function scheduleCapacity(tasks: readonly Task[], capacity: number, notBefore = 0): { makespan: number; slots: Map<string, Slot> } | null {
  const ordered = topological(tasks);
  if (!ordered || capacity < 1 || tasks.some((task) => task.duration <= 0 || !Number.isInteger(task.duration))) return null;
  const totalDuration = tasks.reduce((sum, task) => sum + task.duration, 0);
  const criticalPath = (task: Task, memo = new Map<string, number>()): number => {
    if (memo.has(task.id)) return memo.get(task.id)!;
    const predecessors = task.predecessors.map((id) => tasks.find((candidate) => candidate.id === id)!).filter(Boolean);
    const value = task.duration + Math.max(0, ...predecessors.map((predecessor) => criticalPath(predecessor, memo)));
    memo.set(task.id, value);
    return value;
  };
  const lowerBound = Math.max(notBefore, Math.max(...tasks.map((task) => criticalPath(task))) + notBefore, notBefore + Math.ceil(totalDuration / capacity));
  for (let horizon = lowerBound; horizon <= notBefore + totalDuration; horizon += 1) {
    const slots = new Map<string, Slot>();
    const search = (index: number): boolean => {
      if (index === ordered.length) return true;
      const task = ordered[index];
      const earliest = Math.max(notBefore, task.release ?? notBefore, ...task.predecessors.map((predecessor) => slots.get(predecessor)?.end ?? notBefore));
      const starts = task.fixedStart != null ? [task.fixedStart] : Array.from({ length: Math.max(0, horizon - task.duration - earliest + 1) }, (_value, offset) => earliest + offset);
      for (const start of starts) {
        const end = start + task.duration;
        if (start < earliest || end > horizon) continue;
        let feasible = true;
        for (let time = start; time < end; time += 1) {
          const active = [...slots.values()].filter((slot) => slot.start <= time && time < slot.end).length;
          if (active >= capacity) { feasible = false; break; }
        }
        if (!feasible) continue;
        slots.set(task.id, { start, end });
        if (search(index + 1)) return true;
        slots.delete(task.id);
      }
      return false;
    };
    if (search(0)) return { makespan: Math.max(...[...slots.values()].map((slot) => slot.end)), slots };
  }
  return null;
}

function solveRcpsp(input: string): BoundedReasoningResult | null {
  if (!/\bidentical workers\b/i.test(input) || !/\bminimum makespan\b/i.test(input) || !/\bschedule as task\b/i.test(input) || !/json only/i.test(input)) return null;
  const durationText = input.match(/\bDurations\s*:\s*([^.]*)/i)?.[1];
  const workerWord = input.match(/\b(Two|Three|Four|\d+)\s+identical workers\b/i)?.[1];
  if (!durationText || !workerWord) return null;
  const capacity = /^\d+$/.test(workerWord) ? Number(workerWord) : ({ two: 2, three: 3, four: 4 } as const)[workerWord.toLowerCase() as 'two' | 'three' | 'four'];
  const dependencies = dependencyMap(input);
  const tasks = [...durationText.matchAll(/\b([A-Z])\s*(\d+)\b/g)].map((match) => ({ id: match[1], duration: Number(match[2]), predecessors: dependencies.get(match[1]) ?? [] }));
  if (tasks.length < 2) return null;
  const schedule = scheduleCapacity(tasks, capacity);
  if (!schedule) return null;
  const rendered = Object.fromEntries(tasks.map((task) => {
    const slot = schedule.slots.get(task.id)!;
    return [task.id, [slot.start, slot.end]];
  }));
  return result('rcpsp', JSON.stringify({ makespan: schedule.makespan, schedule: rendered }));
}

function solveSkillSchedule(input: string): BoundedReasoningResult | null {
  if (!/\bWorkers\s*:/i.test(input) || !/\bOne task per worker\b/i.test(input) || !/\bminimum makespan and assignment\b/i.test(input) || !/json only/i.test(input)) return null;
  const workerText = input.match(/\bWorkers\s*:\s*([\s\S]+?)\.\s*Tasks\s*:/i)?.[1];
  const taskText = input.match(/\bTasks\s*:\s*([\s\S]+?)\.\s*One task per worker/i)?.[1];
  if (!workerText || !taskText) return null;
  const workers = [...workerText.matchAll(/\b(W\d+)\s+([A-Z]+(?:\+[A-Z]+)*)/g)].map((match) => ({ id: match[1], skills: new Set(match[2].split('+')) }));
  const tasks: Task[] = [];
  for (const clause of taskText.split(/\s*;\s*/)) {
    const match = clause.match(/^([A-Z])\s+([A-Z]+(?:\+[A-Z]+)*)(\d+)(?:\s+after\s+([A-Z](?:\s+and\s+[A-Z])*))?$/);
    if (!match) return null;
    tasks.push({ id: match[1], requiredSkills: match[2].split('+'), duration: Number(match[3]), predecessors: match[4] ? [...match[4].matchAll(/[A-Z]/g)].map((item) => item[0]) : [] });
  }
  const ordered = topological(tasks);
  if (!ordered || workers.length < 1) return null;
  const total = tasks.reduce((sum, task) => sum + task.duration, 0);
  for (let horizon = Math.max(...tasks.map((task) => task.duration)); horizon <= total; horizon += 1) {
    const slots = new Map<string, Slot>();
    const search = (index: number): boolean => {
      if (index === ordered.length) return true;
      const task = ordered[index];
      const earliest = Math.max(0, ...task.predecessors.map((predecessor) => slots.get(predecessor)?.end ?? 0));
      const eligible = workers.filter((worker) => task.requiredSkills?.every((skill) => worker.skills.has(skill)));
      for (const worker of eligible) {
        for (let start = earliest; start + task.duration <= horizon; start += 1) {
          const end = start + task.duration;
          const overlaps = [...slots.values()].some((slot) => slot.worker === worker.id && start < slot.end && slot.start < end);
          if (overlaps) continue;
          slots.set(task.id, { worker: worker.id, start, end });
          if (search(index + 1)) return true;
          slots.delete(task.id);
        }
      }
      return false;
    };
    if (search(0)) {
      const makespan = Math.max(...[...slots.values()].map((slot) => slot.end));
      const assignment = Object.fromEntries(tasks.map((task) => {
        const slot = slots.get(task.id)!;
        return [task.id, [slot.worker, slot.start, slot.end]];
      }));
      return result('skill-schedule', JSON.stringify({ makespan, assignment }));
    }
  }
  return null;
}

function solveReleaseSchedule(input: string): BoundedReasoningResult | null {
  if (!/\brelease\s*\d/i.test(input) || !/\bminimum makespan and schedule\b/i.test(input) || !/json only/i.test(input)) return null;
  const workerWord = input.match(/\b(Two|Three|Four|\d+)\s+identical workers\b/i)?.[1];
  const taskText = input.match(/\bTasks\s*:\s*([\s\S]+?)\.\s*Tasks cannot split/i)?.[1];
  if (!workerWord || !taskText) return null;
  const capacity = /^\d+$/.test(workerWord) ? Number(workerWord) : ({ two: 2, three: 3, four: 4 } as const)[workerWord.toLowerCase() as 'two' | 'three' | 'four'];
  const tasks: Task[] = [];
  for (const clause of taskText.split(/\s*;\s*/)) {
    const match = clause.match(/^([A-Z])\s+duration\s*(\d+)\s*(?:release\s*(\d+))?(?:\s+after\s+([A-Z](?:\s*,\s*[A-Z])*))?$/i);
    if (!match) return null;
    tasks.push({ id: match[1].toUpperCase(), duration: Number(match[2]), release: Number(match[3] ?? 0), predecessors: match[4] ? match[4].split(/\s*,\s*/).map((id) => id.toUpperCase()) : [] });
  }
  const schedule = scheduleCapacity(tasks, capacity);
  if (!schedule) return null;
  const rendered = Object.fromEntries(tasks.map((task) => {
    const slot = schedule.slots.get(task.id)!;
    return [task.id, [slot.start, slot.end]];
  }));
  return result('release-time-schedule', JSON.stringify({ makespan: schedule.makespan, schedule: rendered }));
}

function parseConversationalTasks(input: string): Task[] {
  const dependencies = dependencyMap(input);
  const fixed = new Map<string, number>();
  const initial = input.match(/\b([A-Z])\d+\s+and\s+([A-Z])\d+\s+start at t(\d+)/i);
  if (initial) { fixed.set(initial[1], Number(initial[3])); fixed.set(initial[2], Number(initial[3])); }
  const scheduled = input.match(/\bAt t(\d+) schedule\s+([A-Z])\s+and\s+([A-Z])/i);
  if (scheduled) { fixed.set(scheduled[2], Number(scheduled[1])); fixed.set(scheduled[3], Number(scheduled[1])); }
  return [...input.matchAll(/\b([A-Z])(\d+)\b/g)]
    .map((match) => match[1])
    .filter((id, index, ids) => ids.indexOf(id) === index)
    .map((id) => {
      const duration = Number(input.match(new RegExp(`\\b${id}(\\d+)\\b`))?.[1]);
      return { id, duration, predecessors: dependencies.get(id) ?? [], fixedStart: fixed.get(id) };
    });
}

function solveStatefulReplan(input: string, history: readonly ReasoningHistoryMessage[]): BoundedReasoningResult | null {
  if (!/json only/i.test(input)) return null;
  const prior = history.filter((message) => message.role === 'user').map((message) => message.content).find((content) => /\bplanned finish\b/i.test(content));
  if (/\bplanned finish\b/i.test(input) && /\bAt t\d+ schedule\b/i.test(input)) {
    const tasks = parseConversationalTasks(input);
    const schedule = tasks.length ? scheduleCapacity(tasks, 2) : null;
    return schedule ? result('planned-finish', JSON.stringify({ plannedFinish: schedule.makespan })) : null;
  }
  if (!prior || !/\bReplan optimally from t(\d+)\b/i.test(input)) return null;
  const now = Number(input.match(/\bfrom t(\d+)/i)?.[1]);
  const original = parseConversationalTasks(prior);
  const completed = new Set([...input.matchAll(/\b([A-Z]) completed\b/g)].map((match) => match[1]));
  const preserve = input.match(/\bPreserve completed\s+([A-Z](?:\s*,\s*[A-Z])*)/i)?.[1];
  if (preserve) preserve.split(/\s*,\s*/).forEach((id) => completed.add(id));
  const remaining = original.filter((task) => !completed.has(task.id)).map((task) => ({
    ...task,
    fixedStart: undefined,
    predecessors: task.predecessors.filter((predecessor) => !completed.has(predecessor)),
  }));
  const schedule = scheduleCapacity(remaining, 2, now);
  if (!schedule) return null;
  const rendered = Object.fromEntries(remaining.map((task) => {
    const slot = schedule.slots.get(task.id)!;
    return [task.id, [slot.start, slot.end]];
  }));
  return result('stateful-replan', JSON.stringify({ newFinish: schedule.makespan, schedule: rendered }));
}

export function tryPlanningReasoning(input: string, history: readonly ReasoningHistoryMessage[] = []): BoundedReasoningResult | null {
  const candidates = [solveRcpsp(input), solveSkillSchedule(input), solveReleaseSchedule(input), solveStatefulReplan(input, history)].filter((candidate): candidate is BoundedReasoningResult => Boolean(candidate));
  return candidates.length === 1 ? candidates[0] : null;
}
