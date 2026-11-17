"""Synthetic files/subprocess responses only. No Docker, VPS or real RPC."""
import ast
import importlib.util
import io
import json
import os
import pathlib
import subprocess
import tempfile
import types
import unittest
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/recovery/r28-infrastructure-readonly.py"
spec = importlib.util.spec_from_file_location("r28_readonly", SCRIPT)
r28 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r28)
SECRET = "SYNTHETIC_PASSWORD_DO_NOT_EXPORT"


class ReadOnlyTests(unittest.TestCase):
    def audit(self):
        stream = io.StringIO()
        return r28.Audit(stream), stream

    def rows(self, stream):
        return [json.loads(line) for line in stream.getvalue().splitlines()]

    def test_command_and_reference_sanitization(self):
        value = r28.command_metadata(["sh", "-c", "TOKEN=" + SECRET + " pm2 resurrect && node /app/orchestrator/main.js --password " + SECRET])
        text = json.dumps(value)
        self.assertNotIn(SECRET, text)
        self.assertIn("pm2_restore", value["traits"])
        self.assertIn("orchestrator", value["traits"])
        self.assertNotIn(SECRET, r28.reference(SECRET))
        self.assertIsNone(r28.safe_sha(SECRET))
        self.assertEqual(r28.human_bytes("1.5GiB"), 1610612736)
        self.assertIsNone(r28.human_bytes(SECRET))

    def test_catalog_matches_the_tested_candidate_without_provider_imports(self):
        image = json.loads((ROOT / "diagnostics/recovery/linux-candidate-results.json").read_text())
        self.assertEqual(r28.QUEUES, image["queues"])
        self.assertEqual(r28.CANDIDATE, image["imageDigest"])

    def test_mutating_subprocesses_and_pm2_cli_are_rejected(self):
        audit, _ = self.audit()
        for command in [["pm2", "jlist"], ["docker", "run", "image"], ["docker", "restart", "postiz"],
                        ["systemctl", "restart", "docker"], ["pnpm", "prisma", "migrate", "deploy"], ["sh", "-c", "anything"]]:
            with self.assertRaisesRegex(ValueError, "NOT_ALLOWED"):
                audit.run(command)

    def test_failed_reads_never_print_command_stderr_or_exception(self):
        audit, stream = self.audit()
        with mock.patch.object(subprocess, "run", return_value=types.SimpleNamespace(returncode=1, stdout=SECRET, stderr=SECRET)):
            self.assertIsNone(audit.run(["docker", "info", "--format", "fixed"]))
        with mock.patch.object(subprocess, "run", side_effect=OSError(SECRET)):
            self.assertIsNone(audit.run(["systemctl", "show", "--no-pager"]))
        self.assertNotIn(SECRET, stream.getvalue())
        self.assertEqual(audit.gaps, 2)

    def test_pm2_dump_projection_and_pid_namespace(self):
        audit, stream = self.audit()
        with tempfile.TemporaryDirectory() as directory:
            home = pathlib.Path(directory) / ".pm2"
            (home / "pids").mkdir(parents=True)
            (home / "dump.pm2").write_text(json.dumps([{"name": SECRET, "pm_exec_path": "/app/orchestrator/main.js", "args": [SECRET],
                "env": {"DATABASE_URL": SECRET}, "TOKEN": SECRET, "autorestart": True, "instances": 1, "cron_restart": "0 * * * *", "status": "online"}]))
            (home / "dump.pm2.bak").write_text(json.dumps([{"pm2_env": {"name": "orchestrator", "pm_exec_path": "/app/main.js", "env": {"TOKEN": SECRET}, "autorestart": True}}]))
            (home / "pm2.pid").write_text("12")
            (home / "pids" / (SECRET + ".pid")).write_text("14")
            r28.discover_pm2(audit, [], [], [str(home)])
        self.assertNotIn(SECRET, stream.getvalue())
        persisted = [r for r in self.rows(stream) if r["section"] == "pm2_persisted"]
        self.assertEqual(len(persisted), 2)
        self.assertTrue(persisted[0]["autorestart"])
        self.assertTrue(persisted[0]["cron_restart_present"])
        self.assertFalse(self.rows(stream)[-1]["cli_invoked"])
        self.assertEqual([r for r in self.rows(stream) if r["section"] == "pm2_pidfile"][0]["namespace_pid"], 14)

    def test_systemd_cron_profile_wrapper_and_unknowns(self):
        audit, stream = self.audit()
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            for name in ["etc/systemd/system", "etc/cron.d", "opt"]:
                (root / name).mkdir(parents=True)
            (root / "etc/systemd/system/pm2-private.service").write_text("[Service]\nEnvironment=TOKEN=" + SECRET + "\nExecStart=/bin/bash /opt/restore.sh\nRestart=always\n[Unit]\nWants=docker.service\n")
            (root / "opt/restore.sh").write_text("#!/bin/sh\n# " + SECRET + "\nTOKEN=" + SECRET + " pm2 resurrect\n")
            (root / "etc/systemd/system/private.timer").write_text("[Timer]\nOnBootSec=5\nPersistent=true\nUnit=pm2-private.service\n")
            (root / "etc/cron.d/private").write_text("TOKEN=" + SECRET + "\n@reboot root docker compose up -d\n* * * * * root /opt/unknown-program\n")
            with mock.patch.object(r28.shutil, "which", return_value=None):
                r28.startup_snapshot(audit, [(root, "host")])
        self.assertNotIn(SECRET, stream.getvalue())
        rows = self.rows(stream)
        self.assertTrue(any(r.get("trigger") == "REBOOT" for r in rows))
        self.assertTrue(any(r["section"] == "wrapper" and "pm2_restore" in r["traits"] for r in rows))
        self.assertTrue(any(r.get("timer_definition") and r["persistence"] for r in rows))
        self.assertTrue(any(r.get("unclassified_lines", 0) > 0 for r in rows))
        self.assertGreater(audit.gaps, 0)  # unavailable systemd is not approval

    def test_process_ancestry_detects_outside_consumer_without_argv_export(self):
        audit, stream = self.audit()
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            for pid, ppid, command in [(100, 1, ["sh"]), (101, 100, ["node", "/app/orchestrator/main.js", SECRET]),
                                       (200, 1, ["node", "/opt/other-worker.js", "--token=" + SECRET])]:
                p = root / str(pid)
                p.mkdir()
                (p / "status").write_text("Name:\tnode\nPPid:\t" + str(ppid) + "\n")
                (p / "cmdline").write_bytes("\0".join(command).encode())
            r28.process_snapshot(audit, [{"pid": 100, "name": "/postiz"}], proc_root=root)
        self.assertNotIn(SECRET, stream.getvalue())
        rows = {r["pid"]: r for r in self.rows(stream)}
        self.assertEqual(rows[101]["container_ref"], "postiz")
        self.assertTrue(rows[200]["outside_known_containers"])

    def test_remote_docker_context_refuses_daemon_queries(self):
        audit, stream = self.audit()
        calls = []
        def fake(args, **kwargs):
            calls.append(args)
            return "tcp://" + SECRET + ":2376"
        with mock.patch.object(r28.shutil, "which", return_value="docker"), mock.patch.object(audit, "run", side_effect=fake):
            self.assertEqual(r28.docker_snapshot(audit), [])
        self.assertEqual(len(calls), 1)
        self.assertNotIn(SECRET, stream.getvalue())
        self.assertIn("LOCAL_UNIX_DOCKER_CONTEXT_REQUIRED", stream.getvalue())

    def test_docker_projection_preserves_restart_and_hides_secrets(self):
        audit, stream = self.audit()
        cid, image, network = "a" * 64, "sha256:" + "b" * 64, "c" * 64
        c = {"id": cid, "name": "/postiz", "image_id": image, "image_ref": "private/" + SECRET + ":v1.7.4",
             "entrypoint": ["sh", "-c"], "cmd": ["TOKEN=" + SECRET + " pm2 resurrect"], "state": "running", "pid": 100,
             "restart": {"Name": "always", "MaximumRetryCount": 0}, "memory": 0, "readonly": False, "cpuset": "0-1",
             "mounts": [{"Source": "/" + SECRET, "Destination": "/app", "RW": True}],
             "networks": {SECRET: {"NetworkID": network, "IPAddress": SECRET}},
             "depends": "postiz-temporal:service_started:false", "project": SECRET}
        def fake(args, **kwargs):
            if args[1:3] == ["context", "inspect"]: return "unix:///var/run/docker.sock"
            if args[1:3] == ["info", "--format"]: return json.dumps({"version": "27.3.1", "arch": "x86_64", "os": "linux", "swarm": "inactive"})
            if args[1:3] == ["version", "--format"]: return '"27.3.1"'
            if args[1:3] == ["container", "ls"]: return cid
            if args[1:3] == ["container", "inspect"]: return json.dumps(c)
            if args[1:3] == ["network", "inspect"]: return json.dumps({"name": SECRET, "internal": False, "driver": "bridge", "members": {cid: {"Name": SECRET}}})
            if args[1:3] == ["stats", "--no-stream"]: return json.dumps({"id": cid[:12], "memory": "1GiB / 4GiB", "cpu": "5.25%", "pids": "9"})
            if args[1:3] == ["image", "ls"]: return image
            if args[1:3] == ["image", "inspect"]: return json.dumps({"id": image, "tags": ["private/" + SECRET + ":v1.7.4"], "digests": ["private/" + SECRET + "@" + image], "os": "linux", "arch": "amd64"})
            self.fail("Unreviewed command " + str(args[:2]))
        with mock.patch.object(r28.shutil, "which", return_value="docker"), mock.patch.object(audit, "run", side_effect=fake), mock.patch.dict(os.environ, {"DOCKER_HOST": ""}):
            r28.docker_snapshot(audit)
        self.assertNotIn(SECRET, stream.getvalue())
        row = next(r for r in self.rows(stream) if r["section"] == "container")
        self.assertEqual(row["restart_policy"], "always")
        self.assertTrue(row["legacy_v174_tag_hint"])
        self.assertTrue(row["code_overlay"])
        self.assertEqual(row["cpu_set"], "0-1")
        self.assertEqual(row["dependency_refs"], ["postiz-temporal"])
        self.assertTrue(any(r.get("memory_used_bytes") == 1073741824 for r in self.rows(stream)))
        self.assertNotIn("Config.Env", r28.CONTAINER_TEMPLATE)

    def test_limits_and_missing_probe_do_not_become_match(self):
        audit, stream = self.audit()
        self.assertEqual(len(audit.bounded(range(5), "test", limit=2)), 2)
        r28.probe_temporal(audit, [], types.SimpleNamespace(no_exec=True))
        self.assertEqual(audit.gaps, 2)
        self.assertNotIn('"status":"MATCH"', stream.getvalue())

    def test_global_output_limit_is_a_visible_gap_and_keeps_summary(self):
        audit, stream = self.audit()
        for i in range(r28.MAX_RECORDS + 20):
            audit.emit("synthetic", ordinal=i)
        audit.emit("summary", gaps=audit.gaps, records_suppressed=audit.suppressed)
        self.assertEqual(len(self.rows(stream)), r28.MAX_RECORDS + 2)
        self.assertIn("GLOBAL_OUTPUT_LIMIT_TRUNCATED", stream.getvalue())
        self.assertEqual(self.rows(stream)[-1]["section"], "summary")
        self.assertGreater(audit.gaps, 0)

    def test_container_symlinks_do_not_read_host_targets(self):
        audit, stream = self.audit()
        with mock.patch.object(pathlib.Path, "is_symlink", return_value=True), mock.patch("builtins.open", side_effect=AssertionError("must not follow")):
            self.assertIsNone(audit.read("/proc/123/root/etc/private.conf"))
        self.assertIn("CONTAINER_SYMLINK_REQUIRES_LOCAL_REVIEW", stream.getvalue())

    def test_stopped_container_pm2_volume_is_included_without_start(self):
        homes = r28.mounted_pm2_homes([{"name": "/postiz", "state": "exited", "mounts": [
            {"Source": "/synthetic/volume", "Destination": "/config"},
            {"Source": "/synthetic/saved", "Destination": "/root/.pm2"}]}])
        self.assertEqual(len(homes), 2)
        self.assertEqual(homes[0][0], pathlib.Path("/synthetic/volume/.pm2"))
        self.assertEqual(homes[1][0], pathlib.Path("/synthetic/saved"))

    def test_temporal_output_is_revalidated_not_forwarded(self):
        audit, stream = self.audit()
        rows = [{"kind": "runtime", "node": "22.20.0", "openssl": "3.0.1", "abi": 127, "arch": SECRET, "platform": "linux"},
                {"kind": "target", "address_ref": SECRET, "namespace_ref": SECRET, "transport": SECRET},
                {"kind": "gap", "reason": SECRET}]
        payload = "noise " + SECRET + "\nR28_JSON=" + json.dumps({"format": "R28_TEMPORAL_READONLY_V1", "rows": rows})
        with mock.patch.object(audit, "run", return_value=payload):
            r28.probe_temporal(audit, [{"id": "a" * 64, "name": "/postiz", "state": "running"}], types.SimpleNamespace(no_exec=False, app_container="postiz", queue=[]))
        self.assertNotIn(SECRET, stream.getvalue())
        self.assertIn("QUEUE_CATALOG_INCOMPLETE", stream.getvalue())

    def test_non_linux_never_runs_infrastructure_commands(self):
        with mock.patch.object(r28.platform, "system", return_value="Windows"), mock.patch.object(r28.Audit, "run", side_effect=AssertionError("must not execute")), mock.patch("sys.stdout", new_callable=io.StringIO):
            self.assertEqual(r28.main(["--expected-sha256", r28.hashlib.sha256(SCRIPT.read_bytes()).hexdigest()]), 2)

    def test_no_environment_logs_or_database_read_paths(self):
        tree = ast.parse(SCRIPT.read_text(encoding="utf-8"))
        imported = [n.module for n in ast.walk(tree) if isinstance(n, ast.ImportFrom)]
        self.assertNotIn("psycopg", imported)
        self.assertNotIn("/proc/environ", SCRIPT.read_text().replace("/proc/environ,", ""))
        self.assertNotIn("Config.Env", r28.CONTAINER_TEMPLATE)
        self.assertNotIn(".Env", r28.IMAGE_TEMPLATE)
        self.assertNotIn("pm2 jlist", SCRIPT.read_text())


if __name__ == "__main__":
    unittest.main(verbosity=2)
