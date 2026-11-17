"""Linux/Windows synthetic stress and end-to-end metadata tests; no real RPC/Docker."""
import collections
import contextlib
import hashlib
import importlib.util
import io
import json
import os
import pathlib
import tempfile
import types
import unittest
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/recovery/r28-infrastructure-readonly.py"
spec = importlib.util.spec_from_file_location("r28_compact", SCRIPT)
r28 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r28)
SECRET = "SYNTHETIC_SECRET_MUST_NEVER_EXPORT"
SHA = lambda: hashlib.sha256(SCRIPT.read_bytes()).hexdigest()


def queue_rows(audit, failure=False):
    for name in r28.QUEUES:
        audit.emit("temporal_queue", queue_ref=name, workflow={"status": "GAP"} if failure else {"pollers": 0}, activity={"pollers": 0})


class CompactTests(unittest.TestCase):
    def make(self, **kwargs):
        out = io.StringIO()
        return r28.CompactAudit(out, **kwargs), out

    def parse(self, out):
        return [json.loads(line) for line in out.getvalue().splitlines()]

    def seed(self, audit):
        audit.emit("audit", format=r28.FORMAT)
        audit.emit("container", object_ref="postiz", id="a" * 12, restart_policy="always", legacy_v174_tag_hint=True, network_refs=["ref:network"], command={"traits": ["pm2"]})
        audit.emit("container", object_ref="postiz-temporal", id="b" * 12, network_refs=["ref:network"])
        audit.emit("process", pid=165, ppid=152, pm2_daemon=False, container_ref="postiz", command={"traits": ["orchestrator", "node"]})
        audit.emit("process", pid=152, pm2_daemon=True, pm2_version="7.1.2", container_ref="postiz", command={"traits": ["pm2"]})
        audit.emit("host", logical_cpus=2, memory_bytes={"MemTotal": 8 * 1024 ** 3, "SwapTotal": 0})

    def test_flood_reproduces_previous_suppression_without_losing_critical_data(self):
        audit, out = self.make()
        for i in range(800):
            audit.emit("systemd_definition", unit_ref="ref:" + r28.digest(i), scope_ref="host", traits=["docker"])
        for i in range(400):
            audit.emit("startup_entry", source_ref="ref:" + r28.digest(i), scope_ref="host", traits=["pm2_restore"], trigger="REBOOT")
        for _ in range(66):
            audit.gap("coverage", "CONTAINER_SYMLINK_REQUIRES_LOCAL_REVIEW", "/synthetic/private")
        self.seed(audit)  # Critical data even after the flood must survive.
        queue_rows(audit)
        self.assertEqual(audit.finish(), 2)
        rows = self.parse(out)
        self.assertLess(len(rows), 100)
        self.assertEqual(len(rows), 44)
        self.assertEqual(len([r for r in rows if r["section"] == "temporal_queue"]), 32)
        self.assertLess(next(i for i, r in enumerate(rows) if r["section"] == "temporal_queue"), next(i for i, r in enumerate(rows) if r["section"] == "return_paths"))
        self.assertEqual(rows[-1]["observation_counts_by_section"]["systemd_definition"], 800)
        self.assertEqual(rows[-1]["observation_counts_by_section"]["startup_entry"], 400)
        self.assertFalse(rows[-1]["output_truncated"])
        self.assertEqual(rows[-1]["output_records"], len(rows))
        self.assertEqual(next(r for r in rows if r["section"] == "gaps")["events"], 66)
        self.assertNotIn("GLOBAL_OUTPUT_LIMIT_TRUNCATED", out.getvalue())
        self.assertIn("TARGET_CONTAINER_CAN_RETURN_AFTER_RESTART", out.getvalue())
        self.assertIn("POSTIZ_TEMPORAL_SHARED_NETWORK_NO_DENIAL_PROOF", out.getvalue())
        self.assertIn("NO_SWAP_MEMORY_SPIKE_RISK", out.getvalue())
        self.assertIn('"pm2_version":"7.1.2"', out.getvalue())

    def test_original_byte_verified_emitter_drops_late_queue_evidence(self):
        original = ROOT / "diagnostics/recovery/archive/r28-infrastructure-readonly-v1-8b01b747.py"
        self.assertEqual(hashlib.sha256(original.read_bytes()).hexdigest(), "8b01b747716b45efd91ce44e056aa77ec3fca3cd559d977397334557cd87dce3")
        old_spec = importlib.util.spec_from_file_location("r28_original_test", original)
        old = importlib.util.module_from_spec(old_spec)
        old_spec.loader.exec_module(old)
        output = io.StringIO()
        audit = old.Audit(output)
        for i in range(676):
            audit.emit("systemd_definition", unit_ref="ref:" + str(i))
        for queue in old.QUEUES:
            audit.emit("temporal_queue", queue_ref=queue, workflow={"pollers": 0}, activity={"pollers": 0})
        self.assertEqual(len([r for r in self.parse(output) if r["section"] == "temporal_queue"]), 0)
        self.assertIn("GLOBAL_OUTPUT_LIMIT_TRUNCATED", output.getvalue())

    def test_missing_queues_are_explicit_gaps_never_zero(self):
        audit, out = self.make()
        self.seed(audit)
        self.assertEqual(audit.finish(), 2)
        queues = [r for r in self.parse(out) if r["section"] == "temporal_queue"]
        self.assertEqual(len(queues), 32)
        self.assertTrue(all(q["workflow"] == {"status": "GAP"} and "pollers" not in q["workflow"] for q in queues))
        self.assertEqual(self.parse(out)[-1]["critical_queue_evidence_missing"], 32)
        self.assertIn("POLLER_COUNTS_UNKNOWN", out.getvalue())

    def test_unknown_count_is_not_treated_as_zero(self):
        audit, out = self.make()
        self.seed(audit)
        queue_rows(audit, failure=True)
        audit.finish()
        self.assertIn("POLLER_COUNTS_UNKNOWN", out.getvalue())
        self.assertNotIn("ZERO_POLLERS_DOES_NOT_PROVE_CONTAINMENT", out.getvalue())

    def test_zero_pollers_is_not_containment_approval(self):
        audit, out = self.make()
        self.seed(audit)
        queue_rows(audit)
        audit.finish()
        self.assertIn("ZERO_POLLERS_DOES_NOT_PROVE_CONTAINMENT", out.getvalue())
        self.assertFalse(self.parse(out)[-1]["persistent_containment_proven"])

    def test_extra_queue_references_and_maximum_catalog_fit_budget(self):
        names = ["orchestrator", "extra2", "extra3", "extra4", "extra5", "extra6", "extra7", "extra8"]
        audit, out = self.make(extra_queues=names)
        self.seed(audit)
        queue_rows(audit)
        for name in names:
            audit.emit("temporal_queue", queue_ref=r28.queue_reference(name), workflow={"pollers": 0}, activity={"pollers": 0})
        audit.finish()
        rows = self.parse(out)
        self.assertEqual(len(rows), 52)
        self.assertEqual(rows[-1]["critical_queue_evidence_missing"], 0)

    def test_container_id_target_is_correlated_to_name(self):
        audit, out = self.make(target="a" * 64)
        self.seed(audit)
        queue_rows(audit)
        audit.finish()
        self.assertEqual(next(r for r in self.parse(out) if r["section"] == "target_container")["object_ref"], "postiz")

    def test_mismatched_checksum_blocks_every_collector(self):
        out = io.StringIO()
        with mock.patch("sys.stdout", out), mock.patch.object(r28.Audit, "run", side_effect=AssertionError("must not execute")), mock.patch.object(r28, "resource_snapshot", side_effect=AssertionError("must not collect")):
            self.assertEqual(r28.main(["--expected-sha256", "0" * 64]), 2)
        rows = self.parse(out)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["reason"], "CHECKSUM_MISMATCH_NO_COLLECTION")

    def test_secondary_failure_does_not_prevent_queue_collection(self):
        out, order = io.StringIO(), []
        def probe(audit, _containers, _args):
            order.append("temporal")
            queue_rows(audit)
        def fail(_audit, _roots):
            order.append("startup")
            raise OSError(SECRET)
        with contextlib.ExitStack() as stack:
            stack.enter_context(mock.patch("sys.stdout", out))
            stack.enter_context(mock.patch.object(r28.platform, "system", return_value="Linux"))
            stack.enter_context(mock.patch.object(r28, "resource_snapshot", side_effect=lambda a: None))
            stack.enter_context(mock.patch.object(r28, "docker_snapshot", return_value=[]))
            stack.enter_context(mock.patch.object(r28, "probe_temporal", side_effect=probe))
            stack.enter_context(mock.patch.object(r28, "process_snapshot", return_value=([], [])))
            stack.enter_context(mock.patch.object(r28, "filesystem_roots", return_value=[]))
            stack.enter_context(mock.patch.object(r28, "discover_pm2", side_effect=lambda *args: None))
            stack.enter_context(mock.patch.object(r28, "startup_snapshot", side_effect=fail))
            self.assertEqual(r28.main(["--expected-sha256", SHA()]), 2)
        self.assertEqual(order, ["temporal", "startup"])
        self.assertEqual(len([r for r in self.parse(out) if r["section"] == "temporal_queue"]), 32)
        self.assertNotIn(SECRET, out.getvalue())

    def test_full_pipeline_with_real_linux_file_parsers_and_fake_metadata_transport(self):
        # Hundreds of actual synthetic files, real collectors, only OS-specific
        # endpoints redirected. On Linux these use Linux path and proc parsers.
        out = io.StringIO()
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            for path in ["etc/systemd/system", "etc/cron.d", "etc/profile.d", "root/.pm2/pids", "proc/100", "proc/152", "proc/165"]:
                (root / path).mkdir(parents=True)
            for i in range(350):
                (root / ("etc/systemd/system/restore-%03d.service" % i)).write_text("[Service]\nEnvironment=TOKEN=" + SECRET + "\nExecStart=/usr/local/bin/node /opt/orchestrator.js\nRestart=always\n")
            for i in range(200):
                (root / ("etc/cron.d/restore-%03d" % i)).write_text("TOKEN=" + SECRET + "\n@reboot root pm2 resurrect\n")
            (root / "root/.pm2/dump.pm2").write_text(json.dumps([{"name": "orchestrator", "pm_exec_path": "/app/orchestrator/main.js", "env": {"TOKEN": SECRET}, "autorestart": True}]))
            (root / "root/.pm2/pm2.pid").write_text("152")
            for pid, ppid, argv in [(100, 1, ["sh"]), (152, 100, ["PM2 v7.1.2: God Daemon (/root/.pm2)"]), (165, 152, ["node", "/app/orchestrator/main.js", SECRET])]:
                (root / ("proc/%s/status" % pid)).write_text("Name:\tnode\nPPid:\t%s\nNSpid:\t%s\n" % (ppid, pid))
                (root / ("proc/%s/cmdline" % pid)).write_bytes("\0".join(argv).encode())
            main_id, temporal_id, net_id = "a" * 64, "b" * 64, "c" * 64
            base = {"state": "running", "restart": {"Name": "always"}, "networks": {"shared": {"NetworkID": net_id}}, "entrypoint": ["sh"], "cmd": ["pm2 resurrect"], "mounts": []}
            containers = [{**base, "id": main_id, "name": "/postiz", "pid": 100, "image_id": "sha256:" + "d" * 64, "image_ref": "app:v1.7.4"},
                          {**base, "id": temporal_id, "name": "/postiz-temporal", "pid": 200, "image_id": "sha256:" + "e" * 64, "image_ref": "temporal:1.28.2"}]
            calls = []
            def fake_run(args, **kwargs):
                calls.append(args[:3])
                def response(value):
                    return types.SimpleNamespace(returncode=0, stdout=value, stderr="")
                cmd = args[1:3]
                if args[0] == "systemctl":
                    return response("Id=pm2-root.service\nActiveState=active\nUnitFileState=enabled\nRestart=always\nMainPID=152\nExecStart=" + SECRET + " pm2 resurrect\n")
                if cmd == ["context", "inspect"]: return response("unix:///var/run/docker.sock")
                if cmd == ["info", "--format"]: return response(json.dumps({"version": "29.5.1", "arch": "x86_64", "os": "linux", "cpus": 2, "memory": 8 * 1024 ** 3, "swarm": "inactive"}))
                if cmd == ["version", "--format"]: return response('"29.5.1"')
                if cmd == ["container", "ls"]: return response(main_id + "\n" + temporal_id)
                if cmd == ["container", "inspect"]: return response("\n".join(json.dumps(c) for c in containers))
                if cmd == ["network", "inspect"]: return response(json.dumps({"name": "shared", "driver": "bridge", "internal": False, "members": {main_id: {}, temporal_id: {}}}))
                if cmd == ["stats", "--no-stream"]: return response("\n".join(json.dumps({"id": i[:12], "cpu": "1.0%", "memory": "1GiB / 8GiB", "pids": "12"}) for i in [main_id, temporal_id]))
                if cmd == ["image", "ls"]: return response("")
                if cmd == ["exec", "--interactive"]:
                    rows = [{"kind": "runtime", "node": "22.20.0", "platform": "linux", "arch": "x64"}, {"kind": "target", "address_ref": "postiz-temporal:7233", "namespace_ref": "default", "transport": "plaintext"}]
                    rows += [{"kind": "queue", "queue_ref": q, "workflow": {"pollers": 0}, "activity": {"pollers": 0}} for q in r28.QUEUES]
                    return response("R28_JSON=" + json.dumps({"format": "R28_TEMPORAL_READONLY_V1", "rows": rows}))
                raise AssertionError("unreviewed command")
            proc_parser = r28.process_snapshot
            with contextlib.ExitStack() as stack:
                stack.enter_context(mock.patch("sys.stdout", out))
                stack.enter_context(mock.patch.object(r28.platform, "system", return_value="Linux"))
                stack.enter_context(mock.patch.object(r28.shutil, "which", side_effect=lambda name: "/usr/bin/" + name))
                stack.enter_context(mock.patch.dict(os.environ, {"DOCKER_HOST": ""}))
                stack.enter_context(mock.patch.object(r28.subprocess, "run", side_effect=fake_run))
                stack.enter_context(mock.patch.object(r28, "filesystem_roots", return_value=[(root, "host")]))
                stack.enter_context(mock.patch.object(r28, "process_snapshot", side_effect=lambda a, c: proc_parser(a, c, proc_root=root / "proc")))
                r28.main(["--expected-sha256", SHA()])
            rows = self.parse(out)
            self.assertEqual(len(rows), 44)
            self.assertEqual(len([r for r in rows if r["section"] == "temporal_queue"]), 32)
            self.assertTrue(rows[-1]["all_queue_counts_known"])
            self.assertEqual(rows[-1]["critical_queue_evidence_missing"], 0)
            self.assertEqual(rows[-1]["observation_counts_by_section"]["systemd_definition"], 128)
            self.assertTrue(rows[-1]["source_limits_observed"])
            self.assertIn("RELEVANT_UNITS_TRUNCATED", out.getvalue())
            self.assertEqual(rows[-1]["observation_counts_by_section"]["startup_entry"], 200)
            self.assertIn('"pm2_version":"7.1.2"', out.getvalue())
            self.assertNotIn(SECRET, out.getvalue())
            self.assertFalse(rows[-1]["output_truncated"])
            self.assertLess(next(i for i, c in enumerate(calls) if c[1:3] == ["exec", "--interactive"]), next(i for i, c in enumerate(calls) if c[0] == "systemctl"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
