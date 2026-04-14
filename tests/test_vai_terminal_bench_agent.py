import shutil
import tempfile
import unittest
from pathlib import Path

from vai_terminal_bench_agent import VaiTerminalBenchAgent


class VaiTerminalBenchAgentTests(unittest.TestCase):
    def setUp(self) -> None:
        self.logs_dir = Path(tempfile.mkdtemp(prefix='vai-tbench-agent-'))
        self.agent = VaiTerminalBenchAgent(logs_dir=self.logs_dir)

    def tearDown(self) -> None:
        shutil.rmtree(self.logs_dir, ignore_errors=True)

    def test_rejects_prose_instead_of_action_json(self) -> None:
        action = self.agent._parse_action('**HTTPS/SSL/TLS** - essential web security')
        self.assertIsNone(action)

    def test_accepts_structured_run_command_action(self) -> None:
        action = self.agent._parse_action(
            '{"action":"run_command","command":"openssl version","reason":"check dependency"}'
        )
        self.assertIsNotNone(action)
        self.assertEqual(action['action'], 'run_command')
        self.assertEqual(action['command'], 'openssl version')

    def test_accepts_legacy_status_command_shape(self) -> None:
        action = self.agent._parse_action(
            '{"status":"command","command":"pwd && ls -la /app","notes":"inspect"}'
        )
        self.assertIsNotNone(action)
        self.assertEqual(action['action'], 'run_command')

    def test_write_file_command_renders_heredoc_and_mode(self) -> None:
        command = self.agent._render_write_file_command('/app/check_cert.py', 'print("ok")\n', '0755')
        self.assertIn("cat > /app/check_cert.py <<'__VAI_EOF__'", command)
        self.assertIn('chmod 0755 /app/check_cert.py', command)

    def test_done_requires_verification(self) -> None:
        state = self.agent._initial_state('Create a file.')
        self.assertFalse(self.agent._can_finish(state))
        state.verification_passed = True
        self.assertTrue(self.agent._can_finish(state))

    def test_repeated_invalid_responses_raise_prompt_collapse_flag(self) -> None:
        state = self.agent._initial_state('Create a file.')
        self.agent._record_invalid_response(state, '**HTTPS**')
        self.agent._record_invalid_response(state, '**HTTPS**')
        self.assertIn('prompt-collapse', state.loop_flags)

    def test_extract_goals_keeps_trailing_verification_requirements(self) -> None:
        instruction = self.agent._normalize_instruction(
            'Your company needs a self-signed TLS certificate for an internal development server.\n\n'
            '1. Create a directory at `/app/ssl/` to store all files\n'
            '2. Generate a 2048-bit RSA private key:\n'
            '   - Save it as `/app/ssl/server.key`\n'
            '   - Ensure proper permissions (600) for the key file\n'
            '3. Create a self-signed certificate with the following details:\n'
            '   - Valid for 365 days (1 year)\n'
            '   - Organization Name: "DevOps Team"\n'
            '   - Common Name: "dev-internal.company.local"\n'
            '   - Save it as `/app/ssl/server.crt`\n'
            '4. Create a combined PEM file that includes both the private key and certificate:\n'
            '   - Save it as `/app/ssl/server.pem`\n'
            '5. Verify the certificate details:\n'
            '   - Create a file called `/app/ssl/verification.txt` containing:\n'
            '     - The certificate\'s SHA-256 fingerprint\n'
            '6. Create a simple Python script at `/app/check_cert.py` that:\n'
            '   - Prints "Certificate verification successful" if all checks pass\n'
        )

        goals = self.agent._extract_goals(instruction)

        self.assertTrue(any('/app/ssl/verification.txt' in goal for goal in goals))
        self.assertTrue(any('/app/check_cert.py' in goal for goal in goals))
        self.assertGreaterEqual(len(goals), 12)

    def test_extract_goals_keeps_prose_requirements_for_regex_tasks(self) -> None:
        instruction = self.agent._normalize_instruction(
            'Write a regex expression that matches dates in the format YYYY-MM-DD appearing in lines that contain an IPv4 address in a log file.\n'
            'If multiple dates are present in a line, the regex should match only the last date in that line.\n'
            'To avoid false matches, ensure that valid dates and IPv4 addresses are not immediately preceded or followed by alphanumeric characters.\n\n'
            'Save your regex in /app/regex.txt\n'
            'The regex will be read from the file and applied to the log file contents using Python\'s re.findall with the re.MULTILINE flag.\n'
        )

        goals = self.agent._extract_goals(instruction)

        self.assertTrue(any('/app/regex.txt' in goal for goal in goals))
        self.assertTrue(any('last date' in goal for goal in goals))
        self.assertGreaterEqual(len(goals), 4)

    def test_extract_goals_keeps_colon_ended_intro_for_log_summary_tasks(self) -> None:
        instruction = self.agent._normalize_instruction(
            'You are given multiple log files stored in /app/logs. Each log file name follows the pattern YYYY-MM-DD_<source>.log, indicating the date of the logs and their source. Your task is to analyze all logs and count how many times each severity appears within the following date ranges:\n'
            'Today (the current date)\n'
            'Last 7 days (including today)\n'
            'Last 30 days (including today)\n'
            'Current month to date (from the 1st date of the current month up to and including today)\n'
            'Total (all log files combined, regardless of date)\n\n'
            'Write a CSV file /app/summary.csv with the following structure (including the header):\n'
            'period,severity,count\n'
            'today,ERROR,<count>\n'
            'The current date is 2025-08-12. Use this as the reference date for all calculations.\n'
        )

        goals = self.agent._extract_goals(instruction)

        self.assertTrue(any('/app/logs' in goal for goal in goals))
        self.assertTrue(any('/app/summary.csv' in goal for goal in goals))
        self.assertTrue(any('2025-08-12' in goal for goal in goals))
        self.assertTrue(any('Last 30 days' in goal for goal in goals))
        self.assertGreaterEqual(len(goals), 8)


if __name__ == '__main__':
    unittest.main()