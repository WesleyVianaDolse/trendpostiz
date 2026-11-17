#!/usr/bin/env python3
"""Manual Linux metadata audit. Stdlib only; no writes, workers or recovery.

Run: sudo python3 -I -B r28-infrastructure-readonly.py --expected-sha256 APPROVED_DIGEST
No PM2 CLI, application imports, logs, /proc/environ, database or social API.
The optional docker exec runs only the embedded read-only Temporal SDK probe.
Unknown/unreadable/truncated evidence is a gap, never containment approval.
"""
import argparse
import collections
import datetime
import hashlib
import json
import os
import pathlib
import platform
import re
import shutil
import subprocess
import sys
import time

FORMAT = "R28_INFRA_READONLY_V2_COMPACT"
CANDIDATE = "sha256:e9a282f01db5f05c187b5107c61ee8623160a2a08a63680f0dd552bc78b26d58"
QUEUES = "main x linkedin reddit instagram facebook threads youtube gmb tiktok pinterest dribbble discord slack kick twitch mastodon bluesky lemmy wrapcast telegram nostr vk medium devto hashnode wordpress listmonk moltbook whop skool mewe".split()
MAX_OBJECTS = 128
MAX_FILE = 1024 * 1024
MAX_RECORDS = 384
COMPACT_RECORD_BUDGET = 96
KNOWN = {"postiz", "postiz-temporal", "postiz-postgres", "postiz-redis", "traefik", "main", "orchestrator", "backend", "frontend", "default", "docker.service", "docker.socket", "containerd.service", "cron.service", "crond.service", "rc-local.service"} | set(QUEUES)
KNOWN |= {"pm2-root.service", "pm2-node.service", "pm2-postiz.service", "postiz.service", "trendpostiz.service", "postiz-orchestrator.service", "node", "nodejs", "pnpm", "pm2", "pm2-runtime", "sh", "bash", "bin/sh", "bin/bash", "usr/local/bin/node", "docker-entrypoint.sh", "nginx"}
TRAITS = {
    "docker": r"\bdocker\b", "compose": r"\b(?:docker-compose|compose)\b",
    "pm2": r"\bpm2\b", "pm2_restore": r"\b(?:resurrect|pm2-runtime)\b",
    "node": r"\b(?:node|nodejs)\b", "orchestrator": r"\borchestrator\b",
    "postiz": r"\b(?:trendpostiz|postiz)\b", "temporal": r"\btemporal\b",
    "other_supervisor": r"\b(?:supervisord?|kubelet|k3s|podman|containerd|dockerd|rootlesskit|conmon)\b",
    "restart": r"\b(?:restart|always|unless-stopped|autorestart)\b",
    "destructive_schema_hint": r"(?:accept-data-loss|prisma-db-push|\bdb\s+push\b)",
}


def digest(value):
    return hashlib.sha256(str(value).encode("utf-8", errors="replace")).hexdigest()[:16]


def reference(value):
    text = str(value).lstrip("/")
    return text if text in KNOWN else "ref:" + digest(value)


def queue_reference(value):
    return value if value in set(QUEUES) | {"default", "postiz-temporal:7233"} else "ref:" + digest(value)


def traits(value):
    return sorted(k for k, pattern in TRAITS.items() if re.search(pattern, str(value), re.I))


def version(value):
    found = re.search(r"(?<!\d)(\d{1,4}\.\d{1,4}(?:\.\d{1,4})?)(?!\d)", str(value))
    return found.group(1) if found else None


def number(value, default=None):
    try:
        n = int(value)
        return n if -1 <= n <= 10 ** 18 else default
    except (TypeError, ValueError, OverflowError):
        return default


def enum(value, choices):
    return value if value in choices else "UNKNOWN"


def container_symlink(path):
    # Do not accidentally follow an absolute container symlink into host files.
    parts = pathlib.Path(path).parts
    if len(parts) > 4 and parts[1] == "proc" and parts[2].isdigit() and parts[3] == "root":
        for end in range(5, len(parts) + 1):
            if pathlib.Path(*parts[:end]).is_symlink():
                return True
    return False


def command_metadata(argv):
    # Never serialize raw argv, arbitrary names, inline code or argument hashes.
    args = argv if isinstance(argv, list) else [str(argv or "")]
    text = " ".join(str(a) for a in args)
    return {"traits": traits(text), "argc": len(args),
            "executable_ref": reference(str(args[0]).split()[0]) if args and str(args[0]).split() else None}


class Audit:
    def __init__(self, stream=None):
        self.stream = stream or sys.stdout
        self.gaps = 0
        self.records = 0
        self.suppressed = 0
        self.started = time.monotonic()

    def emit(self, section, **data):
        if self.records >= MAX_RECORDS and section != "summary":
            self.suppressed += 1
            if self.suppressed == 1:
                self.gaps += 1
                self.records += 1
                self.stream.write('{"section":"coverage","status":"GAP","reason":"GLOBAL_OUTPUT_LIMIT_TRUNCATED"}\n')
            return
        self.records += 1
        self.stream.write(json.dumps({"section": section, **data}, ensure_ascii=True, separators=(",", ":")) + "\n")

    def gap(self, section, reason, obj=None):
        self.gaps += 1
        self.emit(section, status="GAP", reason=reason, object_ref=reference(obj) if obj is not None else None)

    def read(self, path, optional=False, maximum=MAX_FILE):
        try:
            if container_symlink(path):
                self.gap("coverage", "CONTAINER_SYMLINK_REQUIRES_LOCAL_REVIEW", path)
                return None
            with open(path, "rb") as handle:
                data = handle.read(maximum + 1)
            if len(data) > maximum:
                self.gap("coverage", "FILE_SIZE_LIMIT", path)
                return None
            return data.decode("utf-8", errors="replace")
        except FileNotFoundError:
            if not optional:
                self.gap("coverage", "FILE_MISSING", path)
        except (PermissionError, OSError):
            self.gap("coverage", "FILE_UNREADABLE", path)
        return None

    def run(self, args, timeout=8, stdin=None):
        # Explicit metadata command allowlist. No shell, daemon spawn, exec app,
        # Docker lifecycle changes, systemctl activation, Prisma or PM2 calls.
        allowed = (args[0] == "docker" and args[1:3] in [
            ["context", "inspect"], ["container", "ls"], ["container", "inspect"],
            ["image", "ls"], ["image", "inspect"], ["version", "--format"],
            ["info", "--format"], ["stats", "--no-stream"], ["network", "inspect"], ["exec", "--interactive"]
        ]) or (args[0] == "systemctl" and len(args) > 1 and args[1] == "show")
        if not allowed:
            raise ValueError("DIAGNOSTIC_COMMAND_NOT_ALLOWED")
        try:
            result = subprocess.run(args, input=stdin, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                    text=True, encoding="utf-8", errors="replace", timeout=timeout,
                                    check=False, shell=False)
            if result.returncode != 0:
                self.gap("commands", "READ_COMMAND_FAILED", " ".join(args[:2]))
                return None
            if len(result.stdout) > 4 * MAX_FILE:
                self.gap("commands", "OUTPUT_SIZE_LIMIT", args[0])
                return None
            return result.stdout
        except (OSError, subprocess.SubprocessError):
            self.gap("commands", "READ_COMMAND_UNAVAILABLE_OR_TIMEOUT", args[0])
            return None

    def bounded(self, values, section, limit=MAX_OBJECTS):
        values = list(values)
        if len(values) > limit:
            self.gap(section, "OBJECT_LIMIT_TRUNCATED")
        return values[:limit]


class CompactAudit(Audit):
    """Bounded, priority-ordered presentation; secondary events become counts.

    Collectors keep their sanitization and read limits. Counters include every
    collected observation; selected secondary details are explicitly samples.
    Unreadable/unqueried is never converted to absence or to zero pollers.
    """
    def __init__(self, stream=None, target="postiz", extra_queues=None):
        super().__init__(stream)
        self.target = reference(target)
        self.target_id = target[:12] if re.fullmatch(r"[a-f0-9]{64}", target) else None
        self.expected_queues = QUEUES + (extra_queues or [])
        self.counts = collections.Counter()
        self.samples = collections.defaultdict(dict)
        self.scopes = collections.defaultdict(collections.Counter)
        self.relevant = collections.Counter()
        self.gap_reasons = collections.Counter()
        self.gap_refs = collections.defaultdict(set)
        self.queues = {}
        self.sample_limit = 128
        self.sample_evictions = collections.Counter()

    @staticmethod
    def priority(row):
        text = set(row.get("traits") or row.get("execution_traits") or row.get("executable_traits") or row.get("command", {}).get("traits") or [])
        score = sum({"pm2_restore": 100, "orchestrator": 80, "postiz": 70, "pm2": 60,
                     "temporal": 50, "compose": 40, "node": 30, "other_supervisor": 20,
                     "docker": 10}.get(t, 0) for t in text)
        if row.get("object_ref") in {"postiz", "postiz-temporal"}:
            score += 1000
        if row.get("pm2_daemon") or row.get("outside_known_containers"):
            score += 100
        return score

    def emit(self, section, **data):
        self.counts[section] += 1
        self.records += 1  # collected observations, not emitted output lines
        self.scopes[section][data.get("scope_ref", "unspecified")] += 1
        self.relevant[section] += int(self.priority(data) > 0)
        if data.get("status") == "GAP":
            key = (section, data.get("reason", "UNKNOWN"))
            self.gap_reasons[key] += 1
            if data.get("object_ref") is not None and len(self.gap_refs[key]) < 8:
                self.gap_refs[key].add(data["object_ref"])
        if section == "temporal_queue":
            key = data.get("queue_ref")
            if key in self.queues:
                self.gap("temporal", "DUPLICATE_QUEUE_METADATA", key)
            self.queues[key] = data
            return
        # Deduplicate identical projected observations, retain strongest hints.
        encoded = json.dumps(data, sort_keys=True, separators=(",", ":"))
        key = digest(encoded)
        bucket = self.samples[section]
        if key in bucket:
            return
        if len(bucket) < self.sample_limit:
            bucket[key] = data
        else:
            weakest = min(bucket, key=lambda k: (self.priority(bucket[k]), k))
            if (self.priority(data), key) > (self.priority(bucket[weakest]), weakest):
                del bucket[weakest]
                bucket[key] = data
            self.sample_evictions[section] += 1

    def rows(self, section):
        return sorted(self.samples[section].values(), key=lambda r: (-self.priority(r), json.dumps(r, sort_keys=True)))

    def rollup(self, section, limit=6):
        rows = self.rows(section)
        return {"observations": self.counts[section], "relevant_observations": self.relevant[section],
                "scope_counts": dict(self.scopes[section]), "samples": rows[:limit],
                "details_sampled": len(rows) > limit or bool(self.sample_evictions[section]),
                "sample_limit": limit, "sample_candidates_not_retained_or_replaced": self.sample_evictions[section]}

    def finish(self):
        missing = []
        for name in self.expected_queues:
            key = queue_reference(name)
            if key not in self.queues:
                missing.append(key)
                self.gap("temporal", "QUEUE_EVIDENCE_NOT_COLLECTED", key)
        main = next((r for r in self.rows("container") if r.get("object_ref") == self.target or
                     (self.target_id and r.get("id") == self.target_id)), None)
        temporal = next((r for r in self.rows("container") if r.get("object_ref") == "postiz-temporal"), None)
        if main is None:
            self.gap("containers", "TARGET_CONTAINER_EVIDENCE_MISSING", self.target)
        networks = self.rows("docker_network")
        shared = sorted(set(main.get("network_refs", []) if main else []) & set(temporal.get("network_refs", []) if temporal else []))
        known_counts = [q.get(k, {}).get("pollers") for q in self.queues.values() for k in ["workflow", "activity"]]
        all_counts_known = len(known_counts) == len(self.expected_queues) * 2 and all(isinstance(v, int) for v in known_counts)
        risks = ["PERSISTENT_CONTAINMENT_NOT_PROVEN", "CANDIDATE_RESOURCE_AND_T0_WINDOW_NOT_PROVEN"]
        host = self.rows("host")[:1]
        if host and isinstance(host[0].get("logical_cpus"), int) and host[0]["logical_cpus"] <= 2:
            risks.append("LIMITED_CPU_BUDGET_REQUIRES_32_WORKER_MEASUREMENT")
        if host and host[0].get("memory_bytes", {}).get("SwapTotal") == 0:
            risks.append("NO_SWAP_MEMORY_SPIKE_RISK")
        if main and main.get("restart_policy") in {"always", "unless-stopped", "on-failure"}:
            risks.append("TARGET_CONTAINER_CAN_RETURN_AFTER_RESTART")
        if any(p.get("pm2_daemon") for p in self.rows("process")):
            risks.append("PM2_ACTIVE_PERSISTED_RESTORE_REQUIRES_REVIEW")
        if shared:
            risks.append("POSTIZ_TEMPORAL_SHARED_NETWORK_NO_DENIAL_PROOF")
        risks.append("POLLER_COUNTS_UNKNOWN" if not all_counts_known else "POLLERS_OBSERVED_NOT_BINARY_ATTESTATION" if any(known_counts) else "ZERO_POLLERS_DOES_NOT_PROVE_CONTAINMENT")
        header = self.rows("audit")[:1] or [{}]
        output = [{"section": "audit", **header[0]},
                  {"section": "operational_brief", "status": "BLOCKED_FOR_H_I", "risks": risks,
                   "gaps": self.gaps, "missing_queue_evidence": len(missing), "persistent_containment_proven": False,
                   "legacy_version_not_inferred_from_missing_tag": True}]
        for section, row in [("target_container", main), ("temporal_container", temporal)]:
            output.append({"section": section, **(row or {"status": "GAP", "reason": "NOT_COLLECTED"})})
        # Critical metadata and every queue precede all startup details.
        output.append({"section": "temporal_metadata", **{s: self.rows(s)[:1] for s in ["temporal_target", "temporal_server", "temporal_namespace", "temporal_catalog", "container_runtime"]},
                       "missing_queue_refs": missing, "unqueried_is_not_zero": True})
        for name in self.expected_queues:
            key = queue_reference(name)
            row = self.queues.get(key, {"queue_ref": key, "workflow": {"status": "GAP"}, "activity": {"status": "GAP"}, "reason": "NOT_COLLECTED"})
            output.append({"section": "temporal_queue", **row})
        output.append({"section": "pm2_live_and_persisted", **{s: self.rollup(s) for s in ["pm2_home", "pm2_persisted", "pm2_pidfile", "pm2_summary"]},
                       "pidfiles_are_not_live_process_attestation": True})
        output.append({"section": "legacy_consumers", "processes": self.rollup("process", 10),
                       "other_containers": self.rollup("container", 6), "outside_process_namespaces_not_excluded": True})
        output.append({"section": "candidate_resources", **{s: self.rollup(s, 5) for s in ["host", "host_limits", "host_cgroup", "disk", "docker", "docker_client", "container_usage"]},
                       "capacity_32_workers_verified": False, "t0_30_seconds_verified": False})
        output.append({"section": "network_and_images", "shared_network_refs": shared, "networks": self.rollup("docker_network", 6),
                       "ports": self.rollup("container_ports", 4), "images": self.rollup("image", 4), "egress_denial_proven": False})
        output.append({"section": "return_paths", "target_restart_policy": main.get("restart_policy") if main else "UNKNOWN",
                       "pm2_saved_observations": self.counts["pm2_persisted"],
                       "restart_survival_verified": False,
                       "startup": {s: self.rollup(s, 4) for s in ["systemd_definition", "systemd_live", "startup_entry", "wrapper", "startup_summary", "startup_scope"]}})
        grouped = [{"source_section": s, "reason": r, "observations": n, "object_ref_samples": sorted(self.gap_refs[(s, r)]),
                    "object_ref_sample_limit": 8} for (s, r), n in sorted(self.gap_reasons.items())]
        # Group even many failures in one bounded record; critical totals remain.
        output.append({"section": "gaps", "events": self.gaps, "reason_groups": grouped[:48],
                       "reason_groups_total": len(grouped), "reason_groups_sampled": len(grouped) > 48})
        output.append({"section": "summary", "status": "EVIDENCE_ONLY_NEEDS_REVIEW", "format": FORMAT,
                       "output_records": len(output) + 1, "collected_observations": self.records,
                       "observation_counts_by_section": dict(sorted(self.counts.items())), "secondary_details_aggregated": True,
                       "critical_queue_evidence_missing": len(missing), "gaps": self.gaps,
                       "all_queue_counts_known": all_counts_known,
                       "source_limits_observed": any("TRUNCATED" in r or "LIMIT" in r for _, r in self.gap_reasons),
                       "elapsed_ms": round((time.monotonic() - self.started) * 1000),
                       "output_truncated": False, "persistent_containment_proven": False,
                       "other_hosts_not_audited": True, "phase_h": False, "phase_i": False,
                       "t0_window_viability": "NOT_MEASURED_NO_ADMISSION", "production_authorized": False})
        if len(output) > COMPACT_RECORD_BUDGET:
            raise RuntimeError("COMPACT_OUTPUT_CONTRACT_EXCEEDED")
        order = ["audit", "operational_brief", "target_container", "pm2_live_and_persisted", "legacy_consumers",
                 "candidate_resources", "temporal_container", "network_and_images", "temporal_metadata",
                 "temporal_queue", "gaps", "return_paths", "summary"]
        output.sort(key=lambda row: order.index(row["section"]))
        for row in output:
            self.stream.write(json.dumps(row, ensure_ascii=True, separators=(",", ":")) + "\n")
        return 2 if self.gaps else 0


# No Config.Env or complete Config/HostConfig/Labels projection, even internally.
CONTAINER_TEMPLATE = '''{"id":{{json .Id}},"name":{{json .Name}},"image_id":{{json .Image}},"image_ref":{{json .Config.Image}},"entrypoint":{{json .Config.Entrypoint}},"cmd":{{json .Config.Cmd}},"state":{{json .State.Status}},"pid":{{json .State.Pid}},"restart_count":{{json .RestartCount}},"restart":{{json .HostConfig.RestartPolicy}},"memory":{{json .HostConfig.Memory}},"swap":{{json .HostConfig.MemorySwap}},"nano_cpus":{{json .HostConfig.NanoCpus}},"cpu_quota":{{json .HostConfig.CpuQuota}},"cpu_period":{{json .HostConfig.CpuPeriod}},"cpuset":{{json .HostConfig.CpusetCpus}},"pids_limit":{{json .HostConfig.PidsLimit}},"ulimits":{{json .HostConfig.Ulimits}},"privileged":{{json .HostConfig.Privileged}},"readonly":{{json .HostConfig.ReadonlyRootfs}},"network_mode":{{json .HostConfig.NetworkMode}},"ports":{{json .NetworkSettings.Ports}},"networks":{{json .NetworkSettings.Networks}},"mounts":{{json .Mounts}},"links":{{json .HostConfig.Links}},"service":{{json (index .Config.Labels "com.docker.compose.service")}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},"depends":{{json (index .Config.Labels "com.docker.compose.depends_on")}},"compose_files":{{json (index .Config.Labels "com.docker.compose.project.config_files")}},"compose_dir":{{json (index .Config.Labels "com.docker.compose.project.working_dir")}}}'''
IMAGE_TEMPLATE = '''{"id":{{json .Id}},"tags":{{json .RepoTags}},"digests":{{json .RepoDigests}},"arch":{{json .Architecture}},"os":{{json .Os}},"release":{{json (index .Config.Labels "org.opencontainers.image.version")}}}'''
INFO_TEMPLATE = '''{"version":{{json .ServerVersion}},"os":{{json .OSType}},"arch":{{json .Architecture}},"cpus":{{json .NCPU}},"memory":{{json .MemTotal}},"cgroup":{{json .CgroupVersion}},"driver":{{json .CgroupDriver}},"root":{{json .DockerRootDir}},"swarm":{{json .Swarm.LocalNodeState}}}'''


def json_lines(audit, raw, section):
    if raw is None:
        return []
    try:
        return [json.loads(line) for line in raw.splitlines() if line.strip()]
    except (ValueError, TypeError):
        audit.gap(section, "METADATA_FORMAT_UNSUPPORTED")
        return []


def safe_sha(value):
    return value if isinstance(value, str) and re.fullmatch(r"sha256:[a-f0-9]{64}", value) else None


def human_bytes(value):
    found = re.fullmatch(r"\s*([0-9]+(?:\.[0-9]+)?)\s*(B|KiB|MiB|GiB|TiB|kB|MB|GB)\s*", str(value))
    return int(float(found[1]) * {"B": 1, "KiB": 1024, "MiB": 1024 ** 2, "GiB": 1024 ** 3,
                                "TiB": 1024 ** 4, "kB": 1000, "MB": 1000 ** 2, "GB": 1000 ** 3}[found[2]]) if found else None


def resource_snapshot(audit):
    os_release = audit.read("/etc/os-release", optional=True) or ""
    fields = dict(re.findall(r'^([A-Z_]+)=["\']?([^\n"\']*)', os_release, re.M))
    memory = audit.read("/proc/meminfo") or ""
    mem = {k: int(v) * 1024 for k, v in re.findall(r"^(MemTotal|MemAvailable|SwapTotal|SwapFree):\s+(\d+) kB", memory, re.M)}
    distro = fields.get("ID", "")
    audit.emit("host", status="OBSERVED", linux=platform.system() == "Linux",
               arch=enum(platform.machine(), {"x86_64", "aarch64", "armv7l", "arm64", "amd64"}),
               kernel_version=version(platform.release()), distro=distro if re.fullmatch(r"[a-z0-9-]{1,24}", distro) else "UNKNOWN",
               distro_version=fields.get("VERSION_ID") if re.fullmatch(r"[0-9]{1,4}(?:\.[0-9]{1,4}){0,2}", fields.get("VERSION_ID", "")) else None, python_version=platform.python_version(),
               logical_cpus=os.cpu_count(), affinity_cpus=len(os.sched_getaffinity(0)) if hasattr(os, "sched_getaffinity") else None,
               load_1_5_15=list(os.getloadavg()) if hasattr(os, "getloadavg") else None, memory_bytes=mem,
               effective_uid=os.geteuid() if hasattr(os, "geteuid") else None)
    if hasattr(os, "geteuid") and os.geteuid() != 0:
        audit.gap("coverage", "ROOT_VISIBILITY_NOT_AVAILABLE")
    try:
        import resource
        audit.emit("host_limits", nofile=list(resource.getrlimit(resource.RLIMIT_NOFILE)),
                   nproc=list(resource.getrlimit(resource.RLIMIT_NPROC)), address_space=list(resource.getrlimit(resource.RLIMIT_AS)))
    except (ImportError, OSError, ValueError):
        audit.gap("host_limits", "LIMITS_UNAVAILABLE")
    disk_snapshot(audit, "/", "host-root")
    for name in ["cpu.max", "memory.max", "memory.current", "pids.max", "pids.current"]:
        raw = audit.read("/sys/fs/cgroup/" + name, optional=True)
        if raw is not None:
            text = raw.strip()
            audit.emit("host_cgroup", resource=name, value=text if re.fullmatch(r"(?:\d+|max)(?: (?:\d+|max))?", text) else "UNKNOWN")


def disk_snapshot(audit, path, label):
    try:
        v = os.statvfs(path)
        audit.emit("disk", object_ref=label, total_bytes=v.f_blocks * v.f_frsize,
                   available_bytes=v.f_bavail * v.f_frsize, inodes_available=v.f_favail)
    except (AttributeError, OSError):
        audit.gap("disk", "DISK_UNREADABLE", label)


def docker_snapshot(audit):
    if not shutil.which("docker"):
        audit.gap("docker", "DOCKER_CLI_MISSING")
        return []
    endpoint = audit.run(["docker", "context", "inspect", "--format", "{{.Endpoints.docker.Host}}"])
    # Refuse remote daemon access, including environment overrides.
    if not endpoint or not endpoint.strip().startswith("unix:///") or (os.environ.get("DOCKER_HOST") and not os.environ["DOCKER_HOST"].startswith("unix:///")):
        audit.gap("docker", "LOCAL_UNIX_DOCKER_CONTEXT_REQUIRED")
        return []
    infos = json_lines(audit, audit.run(["docker", "info", "--format", INFO_TEMPLATE]), "docker")
    for info in infos:
        audit.emit("docker", server_version=version(info.get("version")), arch=enum(info.get("arch"), {"x86_64", "aarch64", "arm64", "amd64"}),
                   os=enum(info.get("os"), {"linux"}), cpus=number(info.get("cpus")), memory_bytes=number(info.get("memory")),
                   cgroup_version=str(info.get("cgroup")) if str(info.get("cgroup")) in {"1", "2"} else "UNKNOWN",
                   cgroup_driver=enum(info.get("driver"), {"systemd", "cgroupfs"}), swarm=enum(info.get("swarm"), {"active", "inactive", "pending", "locked", "error"}))
        if info.get("swarm") == "active":
            audit.gap("docker", "SWARM_EXTERNAL_RECONCILER_REQUIRES_REVIEW")
        if isinstance(info.get("root"), str) and info["root"].startswith("/"):
            disk_snapshot(audit, info["root"], "docker-root")
    raw = audit.run(["docker", "version", "--format", '{{json .Client.Version}}'])
    audit.emit("docker_client", version=version(raw or ""))
    ids = (audit.run(["docker", "container", "ls", "--all", "--quiet", "--no-trunc"]) or "").split()
    ids = audit.bounded([i for i in ids if re.fullmatch(r"[a-f0-9]{64}", i)], "containers")
    containers = json_lines(audit, audit.run(["docker", "container", "inspect", "--format", CONTAINER_TEMPLATE, *ids]) if ids else "", "containers")
    for c in containers:
        networks = c.get("networks") or {}
        mounts = c.get("mounts") or []
        dependencies = re.findall(r"(?:^|,)([a-zA-Z0-9_.-]+):", str(c.get("depends") or ""))
        cid = str(c.get("id", ""))
        audit.emit("container", object_ref=reference(c.get("name")), id=cid[:12] if re.fullmatch(r"[a-f0-9]{64}", cid) else "UNKNOWN", image_id=safe_sha(c.get("image_id")),
                   image_reference_ref=reference(c.get("image_ref")), legacy_v174_tag_hint=bool(re.search(r"[:/]v?1\.7\.4$", str(c.get("image_ref")))),
                   state=enum(c.get("state"), {"created", "running", "paused", "restarting", "removing", "exited", "dead"}), pid=number(c.get("pid")),
                   entrypoint=command_metadata(c.get("entrypoint")), command=command_metadata(c.get("cmd")),
                   restart_policy=enum((c.get("restart") or {}).get("Name"), {"no", "always", "unless-stopped", "on-failure", ""}),
                   restart_limit=number((c.get("restart") or {}).get("MaximumRetryCount")), restart_count=number(c.get("restart_count")),
                   compose_service=reference(c.get("service")) if c.get("service") else None,
                   compose_project_ref=reference(c.get("project")) if c.get("project") else None,
                   dependency_refs=[reference(d) for d in dependencies], dependency_graph_verified=False, legacy_links_present=bool(c.get("links")),
                   compose_file_refs=[reference(p) for p in str(c.get("compose_files") or "").split(",") if p],
                   network_refs=[reference(n) for n in sorted(networks)], host_network=c.get("network_mode") == "host",
                   privileged=c.get("privileged") is True, readonly_rootfs=c.get("readonly") is True,
                   code_overlay=any(str(m.get("Destination", "")).rstrip("/") in {"", "/app"} or str(m.get("Destination", "")).startswith("/app/") for m in mounts),
                   docker_socket_mount=any("docker.sock" in str(m.get("Destination", "")) or "docker.sock" in str(m.get("Source", "")) for m in mounts),
                   mount_refs=[{"source_ref": reference(m.get("Source")), "target_ref": reference(m.get("Destination")), "rw": m.get("RW") is True} for m in mounts[:16]],
                   limits={k: number(c.get(k)) for k in ["memory", "swap", "nano_cpus", "cpu_quota", "cpu_period", "pids_limit"]},
                   cpu_set=c.get("cpuset") if isinstance(c.get("cpuset"), str) and re.fullmatch(r"[0-9,-]{1,128}", c["cpuset"]) else None,
                   ulimits=[{"name": enum(u.get("Name"), {"nofile", "nproc", "memlock", "core", "cpu", "as", "stack"}), "soft": number(u.get("Soft")), "hard": number(u.get("Hard"))} for u in (c.get("ulimits") or [])[:16]])
        ports = []
        for port, bindings in (c.get("ports") or {}).items():
            if re.fullmatch(r"[0-9]{1,5}/(?:tcp|udp)", port):
                ports.append({"container_port": port, "bindings": [{"host_port": number(b.get("HostPort")),
                              "loopback": b.get("HostIp") in {"127.0.0.1", "::1"}, "all_interfaces": b.get("HostIp") in {"", "0.0.0.0", "::"}} for b in bindings or []]})
        audit.emit("container_ports", object_ref=reference(c.get("name")), ports=ports[:32])
        for net in networks.values():
            net.pop("IPAddress", None)  # Never emit host/container addressing en masse.
    network_ids = audit.bounded(sorted(set(n.get("NetworkID") for c in containers for n in (c.get("networks") or {}).values() if re.fullmatch(r"[a-f0-9]{64}", str(n.get("NetworkID", ""))))), "networks")
    network_template = '{"name":{{json .Name}},"internal":{{json .Internal}},"driver":{{json .Driver}},"attachable":{{json .Attachable}},"members":{{json .Containers}}}'
    for network in json_lines(audit, audit.run(["docker", "network", "inspect", "--format", network_template, *network_ids]) if network_ids else "", "networks"):
        audit.emit("docker_network", network_ref=reference(network.get("name")), internal=network.get("internal") is True,
                   driver=enum(network.get("driver"), {"bridge", "host", "none", "overlay", "macvlan", "ipvlan"}), attachable=network.get("attachable") is True,
                   member_ids=[i[:12] for i in network.get("members") or {} if re.fullmatch(r"[a-f0-9]{64}", i)][:128], egress_denial_proven=False)
    running_ids = [c["id"] for c in containers if c.get("state") == "running" and re.fullmatch(r"[a-f0-9]{64}", str(c.get("id", "")))]
    stats_template = '{"id":{{json .ID}},"cpu":{{json .CPUPerc}},"memory":{{json .MemUsage}},"pids":{{json .PIDs}}}'
    for stat in json_lines(audit, audit.run(["docker", "stats", "--no-stream", "--format", stats_template, *running_ids], timeout=10) if running_ids else "", "container_usage"):
        cpu = re.fullmatch(r"([0-9]+(?:\.[0-9]+)?)%", str(stat.get("cpu", "")))
        mem = str(stat.get("memory", "")).split("/")
        audit.emit("container_usage", id=str(stat.get("id"))[:12] if re.fullmatch(r"[a-f0-9]{12,64}", str(stat.get("id", ""))) else "UNKNOWN",
                   cpu_percent=float(cpu[1]) if cpu else None, memory_used_bytes=human_bytes(mem[0]), memory_limit_bytes=human_bytes(mem[1]) if len(mem) > 1 else None,
                   pids=number(stat.get("pids")))
    images = (audit.run(["docker", "image", "ls", "--all", "--no-trunc", "--quiet"]) or "").split()
    images = audit.bounded(sorted(set(i for i in images if safe_sha(i))), "images")
    for image in json_lines(audit, audit.run(["docker", "image", "inspect", "--format", IMAGE_TEMPLATE, *images]) if images else "", "images"):
        repo_digests = [v.rsplit("@", 1)[-1] for v in image.get("digests") or []]
        audit.emit("image", image_id=safe_sha(image.get("id")), repository_digests=[d for d in repo_digests if safe_sha(d)],
                   tag_refs=[reference(t) for t in (image.get("tags") or [])[:8]],
                   v174_tag_hint=any(re.search(r":v?1\.7\.4$", t) for t in image.get("tags") or []), release_hint=version(image.get("release")),
                   os=enum(image.get("os"), {"linux"}), arch=enum(image.get("arch"), {"amd64", "arm64", "arm"}),
                   candidate_identifier_hint=CANDIDATE in [image.get("id"), *repo_digests], binary_attestation=False)
    return containers


def process_snapshot(audit, containers, proc_root="/proc"):
    entries = []
    try:
        paths = audit.bounded(sorted((p for p in pathlib.Path(proc_root).iterdir() if p.name.isdigit()), key=lambda p: int(p.name)), "processes", 8192)
    except OSError:
        audit.gap("processes", "PROC_UNREADABLE")
        return [], []
    container_roots = {number(c.get("pid")): reference(c.get("name")) for c in containers if number(c.get("pid"), 0) > 0}
    for p in paths:
        try:
            status = (p / "status").read_text(errors="replace")
            ppid = int(re.search(r"^PPid:\s+(\d+)", status, re.M).group(1))
            argv = (p / "cmdline").read_bytes()[:65536].decode("utf-8", "replace").split("\0")
            argv = [v for v in argv if v]
            text = " ".join(argv)
            name = re.search(r"^Name:\s+(.*)", status, re.M).group(1)
            related = bool(re.search(r"(?:node|pm2|orchestrator|temporal|supervisord|kubelet|k3s|podman|docker-compose|dockerd|rootlesskit|conmon)", name + " " + text, re.I))
            namespace = re.search(r"^NSpid:\s+([0-9\s]+)$", status, re.M)
            entries.append({"pid": int(p.name), "ppid": ppid, "argv": argv, "related": related,
                            "namespace_pids": [int(v) for v in namespace[1].split()] if namespace else None})
        except (FileNotFoundError, ProcessLookupError):
            continue  # A naturally completed process is not evidence of failure.
        except (PermissionError, OSError, AttributeError, ValueError):
            audit.gap("processes", "PROCESS_UNREADABLE", p.name)
    by_pid = {p["pid"]: p for p in entries}
    def container_for(pid):
        seen = set()
        while pid and pid not in seen:
            seen.add(pid)
            if pid in container_roots:
                return container_roots[pid]
            pid = by_pid.get(pid, {}).get("ppid", 0)
        return None
    pm2_homes = []
    for p in entries:
        if not p["related"]:
            continue
        text = " ".join(p["argv"])
        c = container_for(p["pid"])
        audit.emit("process", pid=p["pid"], ppid=p["ppid"], namespace_pids=p["namespace_pids"], container_ref=c,
                   outside_known_containers=c is None, command=command_metadata(p["argv"]),
                   pm2_daemon="God Daemon" in text, pm2_version=version(text) if "God Daemon" in text else None)
        home = re.search(r"God Daemon\s*\((/[^\n\0]+)\)", text)
        if home:
            pm2_homes.append((pathlib.Path(proc_root) / str(p["pid"]) / "root" / home.group(1).lstrip("/"), c or "host"))
    return entries, pm2_homes


def filesystem_roots(audit, containers):
    roots = [(pathlib.Path("/"), "host")]
    for c in containers:
        pid = number(c.get("pid"), 0)
        if pid > 0:
            roots.append((pathlib.Path("/proc") / str(pid) / "root", reference(c.get("name"))))
    return audit.bounded(roots, "filesystem_roots", 32)


def mounted_pm2_homes(containers):
    result = []
    for container in containers:
        for mount in container.get("mounts") or []:
            source, target = str(mount.get("Source", "")), str(mount.get("Destination", "")).rstrip("/")
            if not source.startswith("/"):
                continue
            if target.endswith("/.pm2"):
                result.append((pathlib.Path(source), reference(container.get("name"))))
            elif target in {"/config", "/root", "/app", "/home/node", "/home/postiz"}:
                result.append((pathlib.Path(source) / ".pm2", reference(container.get("name"))))
    return result


def discover_pm2(audit, roots, inferred, explicit):
    locations = list(inferred) + [(pathlib.Path(p), "host") for p in explicit]
    for root, label in roots:
        homes = [root / "root", root / "app", root / "config"]
        try:
            if not container_symlink(root / "home"):
                homes.extend((root / "home").iterdir())
        except FileNotFoundError:
            pass
        except OSError:
            audit.gap("pm2", "HOME_DISCOVERY_UNREADABLE", label)
        locations.extend((h / ".pm2", label) for h in homes)
    seen = set()
    found = 0
    for home, label in locations:
        try:
            identity = (home.stat().st_dev, home.stat().st_ino)
            if identity in seen:
                continue
            seen.add(identity)
        except FileNotFoundError:
            continue
        except OSError:
            audit.gap("pm2", "PM2_HOME_UNREADABLE", home)
            continue
        found += 1
        daemon_pid = audit.read(home / "pm2.pid", optional=True, maximum=64)
        audit.emit("pm2_home", home_ref=reference(home), scope_ref=label, daemon_pid=number((daemon_pid or "").strip()),
                   rpc_socket_present=(home / "rpc.sock").exists(), live_rpc_queried=False, daemon_pid_is_origin_namespace=True)
        for filename in ["dump.pm2", "dump.pm2.bak"]:
            raw = audit.read(home / filename, optional=True)
            if raw is None:
                continue
            try:
                rows = json.loads(raw)
                if not isinstance(rows, list):
                    raise ValueError()
                for index, row in enumerate(audit.bounded(rows, "pm2")):
                    if not isinstance(row, dict):
                        raise ValueError()
                    env = row.get("pm2_env") if isinstance(row.get("pm2_env"), dict) else row
                    # Explicit projection only; never output env, args, cwd or dump.
                    audit.emit("pm2_persisted", home_ref=reference(home), source=filename, ordinal=index,
                               process_ref=reference(env.get("name")), executable_ref=reference(env.get("pm_exec_path")),
                               executable_traits=traits(env.get("pm_exec_path", "")),
                               autorestart=env.get("autorestart") if isinstance(env.get("autorestart"), bool) else None,
                               instances=number(env.get("instances")), restart_delay_ms=number(env.get("restart_delay")),
                               cron_restart_present=bool(env.get("cron_restart")), interpreter_ref=reference(env.get("exec_interpreter")),
                               persisted_state=enum(env.get("status"), {"online", "stopped", "errored", "launching", "stopping"}))
            except (ValueError, TypeError):
                audit.gap("pm2", "PM2_DUMP_FORMAT_UNSUPPORTED", home / filename)
        try:
            for pidfile in audit.bounded((home / "pids").glob("*.pid"), "pm2_pidfiles"):
                raw = audit.read(pidfile, maximum=64)
                audit.emit("pm2_pidfile", home_ref=reference(home), process_ref=reference(pidfile.stem), namespace_pid=number((raw or "").strip()),
                           scope_ref=label, note="PID_IS_IN_ORIGIN_NAMESPACE_NOT_HOST_ATTESTATION")
        except OSError:
            audit.gap("pm2", "PIDFILES_UNREADABLE", home)
    audit.emit("pm2_summary", homes_observed=found, cli_invoked=False, daemon_started=False,
               live_names_verified=False, custom_homes_complete=False)


def active_lines(text):
    return [line.strip() for line in text.splitlines() if line.strip() and not line.lstrip().startswith(("#", ";"))]


def inspect_wrapper(audit, command, root, label):
    # One level only, fixed file suffixes, read content without executing it.
    paths = re.findall(r'''(?<![\w/])(/[A-Za-z0-9_./-]+\.(?:sh|cjs|mjs|js))(?=[\s;"']|$)''', command)
    for path in audit.bounded(sorted(set(paths)), "wrappers", 8):
        if ".." in pathlib.PurePosixPath(path).parts:
            audit.gap("wrappers", "UNRESOLVED_WRAPPER", path)
            continue
        raw = audit.read(root / path.lstrip("/"), optional=True, maximum=128 * 1024)
        audit.emit("wrapper", scope_ref=label, path_ref=reference(path), readable=raw is not None,
                   traits=traits("\n".join(active_lines(raw or ""))), transitive_review_complete=False)


def startup_snapshot(audit, roots):
    selected_host_units = set()
    for root, label in roots:
        # Includes enabled symlinks, runtime definitions, vendor units and user units.
        dirs = [root / p for p in ["etc/systemd/system", "run/systemd/system", "usr/lib/systemd/system", "lib/systemd/system", "root/.config/systemd/user"]]
        try:
            dirs.extend(p / ".config/systemd/user" for p in (root / "home").iterdir())
        except FileNotFoundError:
            pass
        except OSError:
            audit.gap("systemd", "USER_UNIT_DISCOVERY_UNREADABLE", label)
        seen_units = set()
        relevant = 0
        for directory in dirs:
            if not directory.exists():
                continue
            if container_symlink(directory):
                audit.gap("systemd", "CONTAINER_SYMLINK_REQUIRES_LOCAL_REVIEW", directory)
                continue
            try:
                paths = audit.bounded(directory.rglob("*"), "systemd_scan", 8192)
                for path in paths:
                    if path.suffix not in {".service", ".timer", ".conf"} or not path.is_file():
                        continue
                    raw = audit.read(path, maximum=256 * 1024)
                    if raw is None:
                        continue
                    lines = active_lines(raw)
                    commands = [v.split("=", 1)[1] for v in lines if re.match(r"^Exec(?:Start|StartPre|StartPost|StopPost|Reload)=", v)]
                    hit = traits(path.name + " " + " ".join(commands))
                    relative_path = path.relative_to(root).as_posix()
                    custom = "etc/systemd" in relative_path or "run/systemd" in relative_path or "/user/" in path.as_posix()
                    if not hit and not custom:
                        continue
                    identity = (str(path), label)
                    if identity in seen_units:
                        continue
                    seen_units.add(identity)
                    relevant += 1
                    if relevant > MAX_OBJECTS:
                        audit.gap("systemd", "RELEVANT_UNITS_TRUNCATED", label)
                        break
                    directives = {}
                    for line in lines:
                        if "=" in line:
                            k, v = line.split("=", 1)
                            directives[k] = v
                    audit.emit("systemd_definition", scope_ref=label, unit_ref=reference(path.name), path_ref=reference(path),
                               traits=hit, custom=custom, enabled_symlink=path.is_symlink(),
                               restart=enum(directives.get("Restart"), {"no", "always", "on-success", "on-failure", "on-abnormal", "on-watchdog", "on-abort"}),
                               persistence=directives.get("Persistent") == "true", timer_definition=path.suffix == ".timer",
                               dependency_refs=[reference(v) for k in ["Requires", "Wants", "PartOf", "BindsTo", "After", "Unit"] for v in directives.get(k, "").split()][:24],
                               environment_read=False)
                    if label == "host" and path.suffix in {".service", ".timer"} and re.fullmatch(r"[A-Za-z0-9@_.:-]+", path.name):
                        selected_host_units.add(path.name)
                    for command in commands:
                        inspect_wrapper(audit, command, root, label)
            except (OSError, ValueError):
                audit.gap("systemd", "UNIT_DISCOVERY_UNREADABLE", label)
        startup_files = [root / "etc/crontab", root / "etc/rc.local", root / "etc/profile", root / "root/.profile", root / "root/.bash_profile", root / "root/.bashrc"]
        for relative in ["etc/cron.d", "var/spool/cron", "var/spool/cron/crontabs", "etc/cron.hourly", "etc/cron.daily", "etc/cron.weekly", "etc/cron.monthly", "etc/profile.d"]:
            try:
                if not container_symlink(root / relative):
                    startup_files.extend((root / relative).iterdir())
            except FileNotFoundError:
                pass
            except OSError:
                audit.gap("startup", "STARTUP_DIRECTORY_UNREADABLE", relative)
        try:
            for directory in (root / "etc").glob("rc*.d"):
                if not container_symlink(directory):
                    startup_files.extend(directory.iterdir())
        except OSError:
            audit.gap("startup", "SYSV_STARTUP_UNREADABLE", label)
        try:
            for home in (root / "home").iterdir():
                startup_files.extend(home / name for name in [".profile", ".bash_profile", ".bashrc"])
        except (FileNotFoundError, OSError):
            pass
        scanned, unknown, reboot = 0, 0, 0
        for path in audit.bounded(sorted(set(startup_files)), "startup_scan", 512):
            if not path.is_file():
                continue
            raw = audit.read(path, maximum=256 * 1024)
            if raw is None:
                continue
            scanned += 1
            for i, line in enumerate(active_lines(raw)):
                # Environment assignments are never serialized, nor are commands.
                hit = traits(line)
                at_reboot = line.startswith("@reboot")
                reboot += int(at_reboot)
                if hit or at_reboot:
                    audit.emit("startup_entry", scope_ref=label, source_ref=reference(path), entry=i,
                               trigger="REBOOT" if at_reboot else "SCHEDULE_OR_SCRIPT", traits=hit, content_exported=False)
                    inspect_wrapper(audit, line, root, label)
                elif not re.match(r"^(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*=", line):
                    unknown += 1
        linger = root / "var/lib/systemd/linger"
        try:
            linger_count = len(list(linger.iterdir())) if linger.exists() else 0
        except OSError:
            linger_count = None
            audit.gap("systemd", "LINGER_STATE_UNREADABLE", label)
        audit.emit("startup_summary", scope_ref=label, files_read=scanned, unclassified_lines=unknown,
                   reboot_entries=reboot, linger_entries=linger_count, indirect_launchers_fully_resolved=False)
    # Current loaded properties may differ from disk; do not print ExecStart/env.
    if shutil.which("systemctl") and selected_host_units:
        props = "Id,ActiveState,SubState,UnitFileState,MainPID,Restart,NeedDaemonReload,ExecStart,Requires,Wants,After,Triggers,TriggeredBy"
        units = audit.bounded(sorted(selected_host_units), "systemd_live", 64)
        raw = audit.run(["systemctl", "show", "--no-pager", "--property=" + props, *units])
        for block in (raw or "").strip().split("\n\n"):
            values = dict(line.split("=", 1) for line in block.splitlines() if "=" in line)
            if not values.get("Id"):
                continue
            audit.emit("systemd_live", unit_ref=reference(values["Id"]),
                       active=enum(values.get("ActiveState"), {"active", "inactive", "activating", "deactivating", "failed", "reloading"}),
                       enabled=enum(values.get("UnitFileState"), {"enabled", "disabled", "static", "masked", "generated", "indirect", "enabled-runtime", "linked", "linked-runtime", "alias"}),
                       restart=enum(values.get("Restart"), {"no", "always", "on-failure", "on-abnormal", "on-success", "on-watchdog", "on-abort"}),
                       main_pid=number(values.get("MainPID")), reload_pending=values.get("NeedDaemonReload") == "yes",
                       execution_traits=traits(values.get("ExecStart", "")),
                       dependency_refs=[reference(v) for k in ["Requires", "Wants", "After", "Triggers", "TriggeredBy"] for v in values.get(k, "").split()][:32])
    else:
        audit.gap("systemd_live", "LIVE_SYSTEMD_STATE_NOT_COLLECTED")


# Only describe/get RPCs; no Worker, NestJS, Prisma, application module, HTTP
# endpoint, workflow/history listing, poll, start, signal, reset or mutation.
TEMPORAL_PROBE = r'''
const fs=require('node:fs'),crypto=require('node:crypto');
const queues=__QUEUES_JSON__, known=new Set(queues.slice(0,32)), rows=[];
const hash=x=>crypto.createHash('sha256').update(String(x)).digest('hex').slice(0,16);
const ref=x=>known.has(x)||x==='default'||x==='postiz-temporal:7233'?x:'ref:'+hash(x);
const emit=()=>console.log('R28_JSON='+JSON.stringify({format:'R28_TEMPORAL_READONLY_V1',rows}));
const cfg=process.env,namespace=cfg.TEMPORAL_NAMESPACE||'default',address=cfg.TEMPORAL_ADDRESS;
const safeCount=x=>/^\d{1,18}$/.test(String(x))?String(x):null;
const version=x=>String(x||'').match(/\d{1,4}\.\d{1,4}(?:\.\d{1,4})?/)?.[0]||null;
const hardDeadline=setTimeout(()=>{rows.push({kind:'gap',reason:'SDK_PROBE_DEADLINE'});emit();process.exit(2);},30000);hardDeadline.unref();
(async()=>{let connection;try{
 rows.push({kind:'runtime',node:version(process.versions.node),openssl:version(process.versions.openssl),abi:safeCount(process.versions.modules),arch:process.arch,platform:process.platform});
 if(!address){rows.push({kind:'gap',reason:'EXPLICIT_TEMPORAL_ADDRESS_MISSING'});return;}
 if(!/^(?:[a-zA-Z0-9_.-]+|\[[a-fA-F0-9:]+\]):\d{1,5}$/.test(address)){rows.push({kind:'gap',reason:'TEMPORAL_ENDPOINT_FORMAT_REQUIRES_REVIEW'});return;}
 const opts={address,connectTimeout:'4 seconds'},keys=['TEMPORAL_CLIENT_CERT_PATH','TEMPORAL_CLIENT_KEY_PATH','TEMPORAL_SERVER_CA_PATH','TEMPORAL_TLS_SERVER_NAME'];
 let transport='plaintext';
 if(keys.some(k=>cfg[k])){
  if(!keys.every(k=>cfg[k])){rows.push({kind:'gap',reason:'INCOMPLETE_MTLS_CONFIGURATION'});return;}
  opts.tls={serverNameOverride:cfg.TEMPORAL_TLS_SERVER_NAME,serverRootCACertificate:fs.readFileSync(cfg.TEMPORAL_SERVER_CA_PATH),clientCertPair:{crt:fs.readFileSync(cfg.TEMPORAL_CLIENT_CERT_PATH),key:fs.readFileSync(cfg.TEMPORAL_CLIENT_KEY_PATH)}};transport='mtls';
 }else if(cfg.TEMPORAL_TLS==='true'){opts.tls=true;transport='tls';}
 if(cfg.TEMPORAL_API_KEY)opts.apiKey=cfg.TEMPORAL_API_KEY;
 rows.push({kind:'target',address_ref:ref(address),namespace_ref:ref(namespace),namespace_defaulted:!cfg.TEMPORAL_NAMESPACE,transport,api_key_configured:!!cfg.TEMPORAL_API_KEY});
 const {Connection}=require('/app/node_modules/@temporalio/client');
 connection=await Connection.connect(opts);
 const read=fn=>connection.withDeadline(Date.now()+2000,fn);
 try{const v=await read(()=>connection.workflowService.getSystemInfo({}));rows.push({kind:'server',version:version(v.serverVersion)});}catch{rows.push({kind:'gap',reason:'SERVER_METADATA_UNAVAILABLE'});}
 try{const v=await read(()=>connection.workflowService.describeNamespace({namespace}));rows.push({kind:'namespace',state:safeCount(v.namespaceInfo?.state)});}catch{rows.push({kind:'gap',reason:'NAMESPACE_METADATA_UNAVAILABLE'});}
 let cursor=0;
 await Promise.all(Array.from({length:8},async()=>{while(cursor<queues.length){const name=queues[cursor++],result={kind:'queue',queue_ref:ref(name)};
  for(const type of [1,2])try{
   const v=await read(()=>connection.workflowService.describeTaskQueue({namespace,taskQueue:{name},taskQueueType:type,includeTaskQueueStatus:true}));
   const all=v.pollers||[],key=type===1?'workflow':'activity';
   result[key]={pollers:all.length,identities:all.slice(0,3).map(p=>({id_ref:'ref:'+hash(p.identity),build_ref:p.workerVersionCapabilities?.buildId?'ref:'+hash(p.workerVersionCapabilities.buildId):null,last_access_unix_seconds:safeCount(p.lastAccessTime?.seconds)})),identities_truncated:all.length>3,backlog_hint:safeCount(v.taskQueueStatus?.backlogCountHint)};
  }catch{result[type===1?'workflow':'activity']={unavailable:true};}
  rows.push(result);
 }}));
}catch{rows.push({kind:'gap',reason:'TEMPORAL_SDK_OR_READ_CONNECTION_FAILED'});}
 finally{if(connection)try{await connection.close();}catch{}clearTimeout(hardDeadline);emit();}})();
'''


def probe_temporal(audit, containers, args):
    if args.no_exec:
        audit.gap("temporal", "CONTAINER_METADATA_PROBE_DISABLED")
        return
    matches = [c for c in containers if str(c.get("name", "")).lstrip("/") == args.app_container or c.get("id") == args.app_container]
    if len(matches) != 1 or matches[0].get("state") != "running":
        audit.gap("temporal", "EXISTING_RUNNING_APP_CONTAINER_REQUIRED")
        return
    code = TEMPORAL_PROBE.replace("__QUEUES_JSON__", json.dumps(QUEUES + args.queue))
    output = audit.run(["docker", "exec", "--interactive", "--env", "NODE_OPTIONS=", "--env", "NODE_DEBUG=", "--env", "DEBUG=",
                        "--env", "NODE_V8_COVERAGE=", "--env", "NODE_COMPILE_CACHE=", "--env", "NODE_DISABLE_COMPILE_CACHE=1",
                        "--env", "GRPC_TRACE=", "--env", "GRPC_VERBOSITY=NONE",
                        matches[0]["id"], "node", "--input-type=commonjs", "-"], timeout=35, stdin=code)
    if output is None:
        audit.gap("temporal", "SDK_PROBE_UNAVAILABLE")
        return
    try:
        payloads = [json.loads(line[len("R28_JSON="):]) for line in output.splitlines() if line.startswith("R28_JSON=")]
        if len(payloads) != 1 or payloads[0].get("format") != "R28_TEMPORAL_READONLY_V1":
            raise ValueError()
        seen = set()
        for row in audit.bounded(payloads[0]["rows"], "temporal", 80):
            kind = row.get("kind")
            if kind == "gap":
                audit.gap("temporal", enum(row.get("reason"), {"EXPLICIT_TEMPORAL_ADDRESS_MISSING", "TEMPORAL_ENDPOINT_FORMAT_REQUIRES_REVIEW", "INCOMPLETE_MTLS_CONFIGURATION", "SERVER_METADATA_UNAVAILABLE", "NAMESPACE_METADATA_UNAVAILABLE", "TEMPORAL_SDK_OR_READ_CONNECTION_FAILED", "SDK_PROBE_DEADLINE"}))
            elif kind == "runtime":
                audit.emit("container_runtime", node=version(row.get("node")), openssl=version(row.get("openssl")), abi=number(row.get("abi")),
                           arch=enum(row.get("arch"), {"x64", "arm64", "arm"}), platform=enum(row.get("platform"), {"linux"}))
            elif kind == "target":
                audit.emit("temporal_target", address_ref=safe_probe_ref(row.get("address_ref")), namespace_ref=safe_probe_ref(row.get("namespace_ref")),
                           namespace_defaulted=row.get("namespace_defaulted") is True, transport=enum(row.get("transport"), {"plaintext", "tls", "mtls"}), api_key_configured=row.get("api_key_configured") is True)
            elif kind == "server":
                audit.emit("temporal_server", version=version(row.get("version")))
            elif kind == "namespace":
                audit.emit("temporal_namespace", state=number(row.get("state")))
            elif kind == "queue":
                q = safe_probe_ref(row.get("queue_ref"))
                seen.add(q)
                values = {}
                for key in ["workflow", "activity"]:
                    v = row.get(key, {})
                    if v.get("unavailable") is True:
                        audit.gap("temporal", "TASK_QUEUE_READ_UNAVAILABLE", q)
                        values[key] = {"status": "GAP"}
                    else:
                        values[key] = {"pollers": number(v.get("pollers")), "backlog_hint": number(v.get("backlog_hint")),
                                       "identity_refs": [safe_probe_ref(i.get("id_ref")) for i in v.get("identities", [])[:3]],
                                       "identity_last_seen_unix_seconds": [number(i.get("last_access_unix_seconds")) for i in v.get("identities", [])[:3]],
                                       "build_refs": [safe_probe_ref(i.get("build_ref")) for i in v.get("identities", [])[:3] if i.get("build_ref")],
                                       "identities_truncated": v.get("identities_truncated") is True}
                        if v.get("identities_truncated"):
                            audit.gap("temporal", "POLLER_IDENTITIES_TRUNCATED", q)
                audit.emit("temporal_queue", queue_ref=q, **values)
        if len(seen) != len(QUEUES) + len(args.queue):
            audit.gap("temporal", "QUEUE_CATALOG_INCOMPLETE")
        audit.emit("temporal_catalog", expected_queues=len(QUEUES) + len(args.queue), observed_queues=len(seen),
                   default_catalog="REVIEWED_CANDIDATE_32", unknown_queue_discovery=False, worker_binary_identity_verified=False,
                   target_source="CONTAINER_INHERITED_CONFIGURATION", effective_pm2_or_dotenv_overrides_verified=False)
    except (ValueError, KeyError, TypeError, AttributeError):
        audit.gap("temporal", "SANITIZED_PROBE_FORMAT_INVALID")


def safe_probe_ref(value):
    return value if isinstance(value, str) and (value in KNOWN or value == "postiz-temporal:7233" or re.fullmatch(r"ref:[a-f0-9]{16}", value)) else "UNKNOWN"


def main(argv=None):
    parser = argparse.ArgumentParser(description="Read-only sanitized R28 infrastructure metadata; never authorizes H/I.")
    parser.add_argument("--app-container", default="postiz", help="Existing app container name or full ID; no container is created")
    parser.add_argument("--no-exec", action="store_true", help="Skip the read-only SDK subprocess; records a Temporal evidence gap")
    parser.add_argument("--pm2-home", action="append", default=[], help="Additional PM2 directory to read locally; never invokes PM2")
    parser.add_argument("--queue", action="append", default=[], help="Additional reviewed legacy queue, metadata only")
    parser.add_argument("--expected-sha256", required=True, help="Approved file digest from the delivery, not generated from the VPS copy")
    args = parser.parse_args(argv)
    if not re.fullmatch(r"[A-Za-z0-9_.-]{1,128}", args.app_container) or len(args.queue) > 8 or any(not re.fullmatch(r"[A-Za-z0-9_.:-]{1,128}", q) for q in args.queue) or len(set(QUEUES + args.queue)) != len(QUEUES + args.queue):
        parser.error("Invalid object identifier or duplicate queue")
    if not re.fullmatch(r"[a-f0-9]{64}", args.expected_sha256):
        parser.error("Expected SHA-256 must be 64 lowercase hexadecimal characters")
    script_bytes = pathlib.Path(__file__).read_bytes()
    actual_sha = hashlib.sha256(script_bytes).hexdigest()
    if actual_sha != args.expected_sha256:
        print(json.dumps({"section": "integrity", "status": "GAP", "reason": "CHECKSUM_MISMATCH_NO_COLLECTION",
                          "actual_sha256": actual_sha, "production_authorized": False}, separators=(",", ":")))
        return 2
    audit = CompactAudit(target=args.app_container, extra_queues=args.queue)
    audit.emit("audit", format=FORMAT, generated_at=datetime.datetime.now(datetime.timezone.utc).isoformat(), candidate_local_identifier=CANDIDATE,
               script_sha256=actual_sha, script_lines=script_bytes.count(b"\n") + int(bool(script_bytes) and not script_bytes.endswith(b"\n")),
               expected_integrity_verified=True,
               read_only=True, secrets_exported=False, phase_h=False, phase_i=False, containment_verified=False, production_authorized=False)
    if platform.system() != "Linux":
        audit.gap("host", "LINUX_REQUIRED_NO_INFRASTRUCTURE_COMMAND_EXECUTED")
        return audit.finish()

    def stage(section, work, fallback=None):
        try:
            return work()
        except Exception:
            # A failed secondary read cannot prevent the queue metadata stage.
            audit.gap(section, "COLLECTION_STAGE_FAILED")
            return fallback

    stage("host", lambda: resource_snapshot(audit))
    containers = stage("containers", lambda: docker_snapshot(audit), [])
    # Probe BEFORE walking unit/cron/profile trees; never poll or start workers.
    stage("temporal", lambda: probe_temporal(audit, containers, args))
    _, homes = stage("processes", lambda: process_snapshot(audit, containers), ([], []))
    observed_process_scopes = {r.get("container_ref") for r in audit.rows("process") if r.get("container_ref")}
    secondary_containers = [c for c in containers if str(c.get("name", "")).lstrip("/") == args.app_container or
                            c.get("id") == args.app_container or reference(c.get("name")) in observed_process_scopes]
    roots = stage("startup_scope", lambda: filesystem_roots(audit, secondary_containers), [])
    audit.emit("startup_scope", container_refs_scanned=[reference(c.get("name")) for c in secondary_containers],
               other_container_filesystems_not_scanned=len(containers) - len(secondary_containers),
               selection="HOST_TARGET_AND_OBSERVED_CONSUMER_SCOPES", scope_complete=False)
    stage("pm2", lambda: discover_pm2(audit, roots, homes + mounted_pm2_homes(containers), args.pm2_home))
    stage("startup", lambda: startup_snapshot(audit, roots))
    return audit.finish()


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print('{"section":"failure","status":"GAP","reason":"AUDIT_INTERRUPTED_NOT_COMPLETE","production_authorized":false}')
        sys.exit(130)
    except Exception:
        print('{"section":"failure","status":"GAP","reason":"AUDIT_FAILED_NO_RAW_ERROR_EXPORTED","production_authorized":false}')
        sys.exit(2)
