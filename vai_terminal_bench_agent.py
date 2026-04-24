import asyncio
import json
import re
import shlex
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import Any

import httpx
import websocket

from harbor.agents.base import BaseAgent
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext


VALID_ACTIONS = {'inspect', 'run_command', 'write_file', 'verify', 'done'}
TERMINAL_HARNESS_MARKER = 'TERMINAL_HARNESS_V1'
WRITE_MODE_RE = re.compile(r'^[0-7]{3,4}$')
PATH_RE = re.compile(r'(/app(?:/[A-Za-z0-9._-]+)+)')
PROSE_PREFIX_RE = re.compile(r'^(?:here|this|that|https|ssl|tls|you|the)\b', re.IGNORECASE)


@dataclass
class TerminalTaskState:
    instruction: str
    goals: list[str]
    environment_facts: list[str] = field(default_factory=list)
    attempted_commands: list[str] = field(default_factory=list)
    file_mutations: list[str] = field(default_factory=list)
    verification_commands: list[str] = field(default_factory=list)
    verification_passed: bool = False
    loop_flags: list[str] = field(default_factory=list)
    invalid_response_count: int = 0
    repeated_invalid_responses: int = 0
    last_invalid_signature: str | None = None
    command_counts: Counter[str] = field(default_factory=Counter)


class VaiTerminalBenchAgent(BaseAgent):
    @staticmethod
    def name() -> str:
        return 'vai-terminal-bench'

    def __init__(
        self,
        logs_dir: Path,
        model_name: str | None = None,
        api_base: str = 'http://127.0.0.1:3006',
        max_steps: int = 8,
        command_timeout_sec: int = 120,
        request_retries: int = 3,
        **kwargs: Any,
    ) -> None:
        super().__init__(logs_dir=logs_dir, model_name=model_name, **kwargs)
        self.api_base = api_base.rstrip('/')
        self.ws_url = self.api_base.replace('http://', 'ws://').replace('https://', 'wss://') + '/api/chat'
        self.max_steps = max_steps
        self.command_timeout_sec = command_timeout_sec
        self.request_retries = request_retries
        self.log_path = self.logs_dir / 'vai-terminal-bench.jsonl'

    def version(self) -> str:
        return '0.2.0'

    async def setup(self, environment: BaseEnvironment) -> None:
        return

    async def run(
        self,
        instruction: str,
        environment: BaseEnvironment,
        context: AgentContext,
    ) -> None:
        normalized_instruction = self._normalize_instruction(instruction)
        state = self._initial_state(normalized_instruction)
        transcript: list[dict[str, Any]] = []
        conversation_id = await self._retry('create-conversation', self._create_conversation)

        for step in range(1, self.max_steps + 1):
            prompt = self._build_prompt(state, transcript, step)
            raw = await self._retry(
                f'ask-vai-step-{step}',
                lambda: self._ask_vai(conversation_id, prompt),
            )
            action, effective_raw, conversation_id = await self._resolve_action(
                conversation_id,
                state,
                transcript,
                step,
                raw,
            )
            entry: dict[str, Any] = {
                'step': step,
                'prompt': prompt,
                'raw': effective_raw,
                'action': action,
                'state': self._snapshot_state(state),
            }

            if action['action'] == 'done':
                if not self._can_finish(state):
                    blocked = self._fallback_action(state, reason='done-blocked-needs-verify')
                    entry['done_blocked'] = True
                    entry['action'] = blocked
                    action = blocked
                else:
                    transcript.append(entry)
                    self._append_log(entry)
                    break

            command = self._command_for_action(action)
            result = await environment.exec(
                command=command,
                timeout_sec=self.command_timeout_sec,
            )

            entry['executed_command'] = command
            entry['result'] = {
                'return_code': result.return_code,
                'stdout': self._truncate(result.stdout),
                'stderr': self._truncate(result.stderr),
            }
            self._update_state(state, action, command, result.return_code, result.stdout, result.stderr)
            entry['state_after'] = self._snapshot_state(state)
            transcript.append(entry)
            self._append_log(entry)

        context.metadata = {
            'api_base': self.api_base,
            'max_steps': self.max_steps,
            'steps_taken': len(transcript),
            'completed': bool(transcript and transcript[-1]['action']['action'] == 'done' and state.verification_passed),
            'verification_passed': state.verification_passed,
            'loop_flags': state.loop_flags,
            'transcript_path': str(self.log_path),
        }

    async def _create_conversation(self) -> str:
        return await asyncio.to_thread(self._create_conversation_sync)

    def _create_conversation_sync(self) -> str:
        response = httpx.post(
            f'{self.api_base}/api/conversations',
            json={
                'modelId': self.model_name or 'vai:v0',
                'mode': 'agent',
                'title': 'terminal-bench',
            },
            timeout=30.0,
            trust_env=False,
        )
        response.raise_for_status()
        payload = response.json()
        return str(payload['id'])

    async def _ask_vai(self, conversation_id: str, prompt: str) -> str:
        return await asyncio.to_thread(self._ask_vai_sync, conversation_id, prompt)

    def _ask_vai_sync(self, conversation_id: str, prompt: str) -> str:
        system_prompt = (
            f'{TERMINAL_HARNESS_MARKER} '
            'You are a terminal-control agent running inside a benchmark harness. '
            'Return exactly one JSON object and nothing else. '
            'Valid actions: '
            '{"action":"inspect","command":"...","reason":"..."}, '
            '{"action":"run_command","command":"...","reason":"..."}, '
            '{"action":"write_file","path":"/app/file","content":"...","mode":"0644","reason":"..."}, '
            '{"action":"verify","command":"...","reason":"..."}, '
            'or {"action":"done","reason":"..."}. '
            'Do not explain the task. Do not output markdown. Do not output prose. '
            'If the task asks you to create, generate, write, or verify something, respond with an action that changes or checks the environment. '
            'Prefer inspect before mutation, use write_file for direct file creation, and never return done before a verify action has succeeded.'
        )

        client = websocket.create_connection(
            self.ws_url,
            timeout=30,
            enable_multithread=True,
            http_proxy_host=None,
            http_proxy_port=None,
        )
        try:
            client.send(
                json.dumps(
                    {
                        'conversationId': conversation_id,
                        'content': prompt,
                        'systemPrompt': system_prompt,
                    }
                )
            )

            text = ''
            while True:
                message = json.loads(client.recv())
                if message.get('type') == 'text_delta' and message.get('textDelta'):
                    text += message['textDelta']
                elif message.get('type') == 'token' and message.get('token'):
                    text += message['token']
                elif message.get('type') == 'done':
                    return text.strip()
                elif message.get('type') == 'error':
                    raise RuntimeError(message.get('error') or 'Vai websocket error')
        finally:
            client.close()

    def _initial_state(self, instruction: str) -> TerminalTaskState:
        return TerminalTaskState(instruction=instruction, goals=self._extract_goals(instruction))

    def _build_prompt(
        self,
        state: TerminalTaskState,
        transcript: list[dict[str, Any]],
        step: int,
    ) -> str:
        phase = self._phase_for(state, step)
        lines = [
            TERMINAL_HARNESS_MARKER,
            f'step={step}/{self.max_steps}',
            f'phase={phase}',
            'workspace=/app',
            '',
            'goals:',
            *[f'- {goal}' for goal in state.goals],
            '',
            'state:',
            *self._state_lines(state),
            '',
            'response_contract:',
            '- Return exactly one JSON object.',
            '- Allowed actions: inspect, run_command, write_file, verify, done.',
            '- inspect must not mutate files.',
            '- write_file is preferred when you need to create or replace file contents directly.',
            '- verify must run a real verification command before done.',
            '- done is only valid after verification has passed.',
            '- Never repeat the same failing action without new evidence.',
        ]

        if transcript:
            lines.extend(['', 'recent_history:'])
            for item in transcript[-3:]:
                action = item['action']
                action_name = action['action']
                if action_name == 'write_file':
                    lines.append(f"- write_file {action['path']}")
                else:
                    lines.append(f"- {action_name}: {action.get('command', '')}".rstrip())
                result = item.get('result')
                if result:
                    lines.append(f"  rc={result['return_code']}")
                    summary = self._result_summary(result.get('stdout', ''), result.get('stderr', ''))
                    if summary:
                        lines.append(f'  summary: {summary}')
        else:
            lines.extend(['', 'recent_history:', '- none'])

        if 'prompt-collapse' in state.loop_flags:
            lines.extend([
                '',
                'recovery_guardrail:',
                '- Previous invalid replies collapsed into conceptual prose. Ignore that impulse and emit a concrete action JSON object only.',
            ])

        return '\n'.join(lines)

    def _extract_goals(self, instruction: str) -> list[str]:
        goals: list[str] = []
        first_line = ''
        in_code_block = False
        for raw_line in instruction.splitlines():
            stripped = raw_line.strip()
            if stripped.startswith('```'):
                in_code_block = not in_code_block
                continue
            if in_code_block:
                continue
            if not stripped:
                continue
            candidate = stripped[2:].strip() if stripped.startswith('- ') else stripped
            if not first_line:
                first_line = candidate
            if self._should_skip_goal_line(candidate):
                continue
            if candidate not in goals:
                goals.append(candidate)
            if len(goals) >= 40:
                break
        if not goals and first_line:
            goals.append(first_line)
        return goals[:40]

    def _should_skip_goal_line(self, line: str) -> bool:
        if not line:
            return True
        if line.endswith(':'):
            has_path = '/app/' in line
            has_digits = bool(re.search(r'\d', line))
            long_sentence = len(line.split()) > 8
            if not has_path and not has_digits and not long_sentence:
                return True
        return False

    def _phase_for(self, state: TerminalTaskState, step: int) -> str:
        if not state.attempted_commands:
            return 'inspect'
        if state.verification_passed:
            return 'done-ready'
        if step >= self.max_steps - 1:
            return 'verify'
        if state.file_mutations:
            return 'verify-soon'
        if state.loop_flags:
            return 'recover'
        return 'act'

    def _state_lines(self, state: TerminalTaskState) -> list[str]:
        lines = [f'- verification={"passed" if state.verification_passed else "pending"}']
        if state.environment_facts:
            lines.append(f'- environment_facts={" | ".join(state.environment_facts[-3:])}')
        else:
            lines.append('- environment_facts=none')
        if state.attempted_commands:
            lines.append(f'- attempted_commands={" | ".join(state.attempted_commands[-3:])}')
        else:
            lines.append('- attempted_commands=none')
        if state.file_mutations:
            lines.append(f'- file_mutations={" | ".join(state.file_mutations[-4:])}')
        else:
            lines.append('- file_mutations=none')
        if state.verification_commands:
            lines.append(f'- verification_commands={" | ".join(state.verification_commands[-2:])}')
        if state.loop_flags:
            lines.append(f'- loop_flags={" | ".join(state.loop_flags[-3:])}')
        return lines

    async def _resolve_action(
        self,
        conversation_id: str,
        state: TerminalTaskState,
        transcript: list[dict[str, Any]],
        step: int,
        raw: str,
    ) -> tuple[dict[str, Any], str, str]:
        action = self._parse_action(raw)
        if action is not None:
            self._clear_invalid_state(state)
            return action, raw, conversation_id

        self._record_invalid_response(state, raw)
        repaired_raw = await self._retry(
            f'repair-vai-step-{step}',
            lambda: self._ask_vai(conversation_id, self._build_repair_prompt(state, transcript, raw)),
        )
        repaired_action = self._parse_action(repaired_raw)
        if repaired_action is not None:
            self._clear_invalid_state(state)
            return repaired_action, repaired_raw, conversation_id

        self._record_invalid_response(state, repaired_raw)
        effective_raw = repaired_raw
        if state.repeated_invalid_responses >= 2:
            self._add_loop_flag(state, 'conversation-reset')
            conversation_id = await self._retry('create-conversation-recovery', self._create_conversation)
            recovery_raw = await self._retry(
                f'recover-vai-step-{step}',
                lambda: self._ask_vai(conversation_id, self._build_recovery_prompt(state, transcript, repaired_raw)),
            )
            recovery_action = self._parse_action(recovery_raw)
            if recovery_action is not None:
                self._clear_invalid_state(state)
                return recovery_action, recovery_raw, conversation_id
            self._record_invalid_response(state, recovery_raw)
            effective_raw = recovery_raw

        return self._fallback_action(state, reason='invalid-action'), effective_raw, conversation_id

    def _parse_action(self, raw: str) -> dict[str, Any] | None:
        parsed = self._parse_json_object(raw.strip())
        if parsed is None:
            return None

        action_name = str(parsed.get('action') or parsed.get('status') or '').strip().lower()
        if action_name == 'command':
            action_name = 'run_command'
        if action_name not in VALID_ACTIONS:
            return None

        reason = str(parsed.get('reason') or parsed.get('notes') or parsed.get('summary') or '').strip()
        if action_name in {'inspect', 'run_command', 'verify'}:
            command = str(parsed.get('command', '')).strip()
            if not self._looks_like_shell_command(command):
                return None
            if action_name == 'inspect' and self._command_likely_mutates(command):
                return None
            return {
                'action': action_name,
                'command': command,
                'reason': reason,
            }

        if action_name == 'write_file':
            path = str(parsed.get('path', '')).strip()
            content = parsed.get('content')
            mode = str(parsed.get('mode', '')).strip() or None
            if not path or not isinstance(content, str):
                return None
            if mode and not WRITE_MODE_RE.fullmatch(mode):
                return None
            return {
                'action': 'write_file',
                'path': path,
                'content': content,
                'mode': mode,
                'reason': reason,
            }

        return {
            'action': 'done',
            'reason': reason,
        }

    def _build_repair_prompt(
        self,
        state: TerminalTaskState,
        transcript: list[dict[str, Any]],
        invalid_raw: str,
    ) -> str:
        recent_actions = []
        for item in transcript[-3:]:
            action = item['action']
            if action['action'] == 'write_file':
                recent_actions.append(f"write_file {action['path']}")
            else:
                recent_actions.append(f"{action['action']} {action.get('command', '')}".strip())
        return '\n'.join([
            TERMINAL_HARNESS_MARKER,
            'invalid_reply_discarded=true',
            'Return exactly one JSON object. No markdown. No explanation. No prose.',
            'Valid actions only: inspect, run_command, write_file, verify, done.',
            'If you need to write a file, use {"action":"write_file","path":"/app/file","content":"...","mode":"0644","reason":"..."}.',
            'Do not answer with conceptual HTTPS/TLS/security descriptions.',
            '',
            'goals:',
            *[f'- {goal}' for goal in state.goals],
            '',
            'state:',
            *self._state_lines(state),
            '',
            f'recent_actions={" | ".join(recent_actions) if recent_actions else "none"}',
            '',
            'invalid_reply:',
            self._truncate(invalid_raw, limit=500),
        ])

    def _build_recovery_prompt(
        self,
        state: TerminalTaskState,
        transcript: list[dict[str, Any]],
        invalid_raw: str,
    ) -> str:
        return '\n'.join([
            TERMINAL_HARNESS_MARKER,
            'recovery_mode=true',
            'Previous attempts collapsed into invalid prose and are discarded.',
            'Return a single JSON action object only.',
            'Allowed actions: inspect, run_command, write_file, verify, done.',
            'This task is graded by the resulting filesystem/process state, not by explanation quality.',
            '',
            self._build_prompt(state, transcript, step=min(len(transcript) + 1, self.max_steps)),
            '',
            'Most recent invalid reply:',
            self._truncate(invalid_raw, limit=500),
        ])

    def _command_for_action(self, action: dict[str, Any]) -> str:
        if action['action'] == 'write_file':
            return self._render_write_file_command(action['path'], action['content'], action.get('mode'))
        return str(action.get('command', '')).strip()

    def _render_write_file_command(self, path: str, content: str, mode: str | None) -> str:
        directory = str(PurePosixPath(path).parent)
        quoted_path = shlex.quote(path)
        prefix = ''
        if directory and directory not in {'.', '/'}:
            prefix = f'mkdir -p {shlex.quote(directory)} && '
        command = prefix + f"cat > {quoted_path} <<'__VAI_EOF__'\n{content}\n__VAI_EOF__"
        if mode:
            command += f'\nchmod {mode} {quoted_path}'
        return command

    def _fallback_action(self, state: TerminalTaskState, reason: str) -> dict[str, Any]:
        if not state.attempted_commands:
            command = "pwd && ls -la /app && find /app -maxdepth 2 \\( -type f -o -type d \\) | sort | sed -n '1,120p'"
        else:
            command = "find /app -maxdepth 3 \\( -type f -o -type d \\) | sort | sed -n '1,160p'"
        return {
            'action': 'inspect',
            'command': command,
            'reason': reason,
        }

    def _can_finish(self, state: TerminalTaskState) -> bool:
        return state.verification_passed

    def _update_state(
        self,
        state: TerminalTaskState,
        action: dict[str, Any],
        executed_command: str,
        return_code: int,
        stdout: str | None,
        stderr: str | None,
    ) -> None:
        state.attempted_commands.append(executed_command)
        normalized_command = re.sub(r'\s+', ' ', executed_command.strip())
        state.command_counts[normalized_command] += 1
        if state.command_counts[normalized_command] >= 2:
            self._add_loop_flag(state, 'repeated-command')

        summary = self._summarize_execution(executed_command, return_code, stdout, stderr)
        if summary:
            self._record_fact(state, summary)

        action_name = action['action']
        if action_name == 'write_file':
            self._record_mutation(state, action['path'])
        elif action_name in {'run_command', 'verify'} and self._command_likely_mutates(executed_command):
            for path in PATH_RE.findall(executed_command):
                self._record_mutation(state, path)

        if action_name == 'verify':
            state.verification_commands.append(executed_command)
            state.verification_passed = return_code == 0
            if return_code != 0:
                self._add_loop_flag(state, 'verification-failed')

    def _summarize_execution(
        self,
        executed_command: str,
        return_code: int,
        stdout: str | None,
        stderr: str | None,
    ) -> str:
        summary = self._result_summary(stdout or '', stderr or '')
        prefix = f'rc={return_code} '
        command_head = re.sub(r'\s+', ' ', executed_command.strip())[:80]
        if summary:
            return f'{prefix}{command_head} -> {summary}'
        return f'{prefix}{command_head}'

    def _result_summary(self, stdout: str, stderr: str) -> str:
        for stream in (stderr, stdout):
            for line in stream.splitlines():
                stripped = line.strip()
                if stripped:
                    return stripped[:180]
        return ''

    def _record_fact(self, state: TerminalTaskState, fact: str) -> None:
        if not fact:
            return
        if fact not in state.environment_facts:
            state.environment_facts.append(fact)
        if len(state.environment_facts) > 8:
            del state.environment_facts[:-8]

    def _record_mutation(self, state: TerminalTaskState, path: str) -> None:
        normalized = path.strip()
        if not normalized:
            return
        if normalized not in state.file_mutations:
            state.file_mutations.append(normalized)
        if len(state.file_mutations) > 8:
            del state.file_mutations[:-8]

    def _record_invalid_response(self, state: TerminalTaskState, raw: str) -> None:
        state.invalid_response_count += 1
        signature = self._invalid_signature(raw)
        if signature == state.last_invalid_signature:
            state.repeated_invalid_responses += 1
        else:
            state.last_invalid_signature = signature
            state.repeated_invalid_responses = 1
        if state.repeated_invalid_responses >= 2:
            self._add_loop_flag(state, 'prompt-collapse')

    def _clear_invalid_state(self, state: TerminalTaskState) -> None:
        state.repeated_invalid_responses = 0
        state.last_invalid_signature = None

    def _invalid_signature(self, raw: str) -> str:
        compact = re.sub(r'\s+', ' ', raw.strip().lower())
        return compact[:200]

    def _add_loop_flag(self, state: TerminalTaskState, flag: str) -> None:
        if flag not in state.loop_flags:
            state.loop_flags.append(flag)

    def _normalize_instruction(self, instruction: str) -> str:
        lines = []
        for raw_line in instruction.strip().splitlines():
            line = raw_line.rstrip()
            line = re.sub(r'^(\s*)\d+\.\s+', r'\1- ', line)
            lines.append(line)
        return '\n'.join(lines)

    def _looks_like_shell_command(self, command: str) -> bool:
        stripped = command.strip()
        if not stripped:
            return False
        if stripped.startswith(('**', '#', '{', '[', '- ', '* ')):
            return False
        first_line = stripped.splitlines()[0].strip()
        if PROSE_PREFIX_RE.match(first_line):
            return False
        first_token = first_line.split()[0]
        if len(first_token) > 80:
            return False
        if not re.fullmatch(r'[A-Za-z0-9_./:-]+', first_token):
            return False
        return True

    def _command_likely_mutates(self, command: str) -> bool:
        lowered = command.lower()
        if '>' in command or '>>' in command:
            return True
        mutation_patterns = [
            r'(^|[;&|]\s*)(mkdir|touch|mv|cp|rm|chmod|chown|install)\b',
            r'cat\s*>',
            r'sed\s+-i\b',
            r'perl\s+-0pi\b',
            r'python\s+-c\b.*write',
            r'python3\s+-c\b.*write',
            r'tee\b',
        ]
        return any(re.search(pattern, lowered) for pattern in mutation_patterns)

    def _parse_json_object(self, text: str) -> dict[str, Any] | None:
        try:
            value = json.loads(text)
            return value if isinstance(value, dict) else None
        except json.JSONDecodeError:
            pass

        match = re.search(r'\{[\s\S]*\}', text)
        if not match:
            return None
        try:
            value = json.loads(match.group(0))
            return value if isinstance(value, dict) else None
        except json.JSONDecodeError:
            return None

    def _snapshot_state(self, state: TerminalTaskState) -> dict[str, Any]:
        return {
            'goals': state.goals,
            'environment_facts': state.environment_facts[-4:],
            'attempted_commands': state.attempted_commands[-4:],
            'file_mutations': state.file_mutations[-4:],
            'verification_commands': state.verification_commands[-2:],
            'verification_passed': state.verification_passed,
            'loop_flags': state.loop_flags[-4:],
            'invalid_response_count': state.invalid_response_count,
        }

    def _truncate(self, value: str | None, limit: int = 1200) -> str:
        text = (value or '').strip()
        if len(text) <= limit:
            return text
        return text[:limit].rstrip() + ' ...[truncated]'

    def _append_log(self, entry: dict[str, Any]) -> None:
        self.logs_dir.mkdir(parents=True, exist_ok=True)
        with self.log_path.open('a', encoding='utf-8') as handle:
            handle.write(json.dumps(entry, ensure_ascii=True) + '\n')

    async def _retry(self, label: str, fn) -> Any:
        last_error: Exception | None = None
        for attempt in range(1, self.request_retries + 1):
            try:
                return await fn()
            except Exception as error:  # noqa: BLE001
                last_error = error
                if attempt >= self.request_retries:
                    raise
                self.logger.warning(
                    '%s failed on attempt %s/%s: %s',
                    label,
                    attempt,
                    self.request_retries,
                    error,
                )
                await asyncio.sleep(0.75 * attempt)
        if last_error is not None:
            raise last_error