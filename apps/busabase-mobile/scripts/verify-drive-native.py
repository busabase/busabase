#!/usr/bin/env python3
"""Run the real Android drive-field upload story against disposable local services.

Requires adb, an already booted Android emulator, uiautomator2==3.5.0 and a debug
APK built from this branch with reactNativeDevServerIp=127.0.0.1 and
reactNativeDevServerPort=8095 (or --metro-port).
No upload transport, file picker or server is mocked.
The output directory holds evidence; the database/storage live in a fresh child
directory and are never taken from a developer's environment.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import uuid
import xml.etree.ElementTree as ET


def eventually(action, description, timeout=120):
    deadline = time.monotonic() + timeout
    last_error = None
    while time.monotonic() < deadline:
        try:
            result = action()
            if result is not None and result is not False:
                return result
        except (OSError, ValueError, AssertionError, urllib.error.URLError) as error:
            last_error = error
        time.sleep(1)
    raise AssertionError(f"Timed out: {description}; last error: {last_error}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apk", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--serial", default=os.environ.get("ANDROID_SERIAL", "emulator-5554"))
    parser.add_argument("--server-port", type=int, default=15519)
    parser.add_argument("--metro-port", type=int, default=8095)
    args = parser.parse_args()
    import uiautomator2 as u2

    repo = Path(__file__).resolve().parents[3]
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    state = Path(tempfile.mkdtemp(prefix="isolated-", dir=output))
    server = f"http://127.0.0.1:{args.server_port}"
    metro = f"http://127.0.0.1:{args.metro_port}"
    adb_prefix = [shutil.which("adb") or "adb", "-s", args.serial]
    processes = []
    logs = []
    device = None
    recording = None
    app_id = "com.busabase.app"

    def adb(*arguments, timeout=120):
        with (output / "commands.log").open("a") as log:
            log.write(f"adb {' '.join(arguments)}\n")
        return subprocess.check_output([*adb_prefix, *arguments], timeout=timeout)

    def http(path, data=None):
        request = urllib.request.Request(
            server + path,
            data=json.dumps(data).encode() if data is not None else None,
            headers={"content-type": "application/json"},
        )
        with urllib.request.urlopen(request, timeout=30) as response:
            body = response.read()
            return json.loads(body) if "json" in response.headers.get("content-type", "") else body

    def start(command, app, name, env):
        log = (output / f"{name}.log").open("wb")
        logs.append(log)
        process = subprocess.Popen(
            command, cwd=repo / "apps" / app, env=env,
            stdout=log, stderr=subprocess.STDOUT, start_new_session=True,
        )
        processes.append(process)

    def hierarchy():
        text = device.dump_hierarchy(compressed=False)
        (output / "latest.xml").write_text(text)
        return ET.fromstring(text)

    def node(label, contains=False):
        matches = [
            item for item in hierarchy().iter("node")
            if any(
                (label in value if contains else value == label)
                for value in (item.get("text", ""), item.get("content-desc", ""))
            )
        ]
        if not matches:
            return None
        button = next((item for item in matches if item.get("class") == "android.widget.Button"), None)
        if button is not None:
            return button
        return next((item for item in matches if item.get("clickable") == "true"), matches[-1])

    def wait_label(label, timeout=120, contains=False):
        return eventually(lambda: node(label, contains), f"native UI: {label}", timeout)

    def tap(label, contains=False):
        dismiss_development_warning()
        item = wait_label(label, contains=contains)
        x1, y1, x2, y2 = map(int, re.findall(r"\d+", item.attrib["bounds"]))
        width, height = device.window_size()
        assert 0 <= x1 < x2 <= width and 0 <= y1 < y2 <= height, item.attrib
        print(f"Tap {label}", flush=True)
        device.click((x1 + x2) // 2, (y1 + y2) // 2)

    def dismiss_development_warning():
        # RN's dismissible warning toast overlays the landing screen's bottom
        # action. Close that specific toast through its real UI control; errors
        # and their diagnostic overlays are left intact.
        tree = hierarchy()
        toasts = [
            item for item in tree.iter("node")
            if item.get("content-desc") == "!, Open debugger to view warnings."
        ]
        for toast in toasts:
            close = next((
                item for item in toast.iter("node")
                if item is not toast and item.get("clickable") == "true"
                and not item.get("text") and not item.get("content-desc")
            ), None)
            assert close is not None, "The development warning toast has no close control"
            x1, y1, x2, y2 = map(int, re.findall(r"\d+", close.attrib["bounds"]))
            print("Dismiss React Native's development warning toast", flush=True)
            device.click((x1 + x2) // 2, (y1 + y2) // 2)
        if toasts:
            eventually(lambda: node("!, Open debugger to view warnings.") is None, "warning toast closed", 15)

    def fill(label, text):
        eventually(lambda: visible_input(hierarchy(), label), f"visible native text input: {label}")
        device(description=label, className="android.widget.EditText").set_text(text)

    def visible_input(tree, label):
        return next((
            item for item in tree.iter("node")
            if item.get("class") == "android.widget.EditText"
            and item.get("content-desc") == label
            and item.get("visible-to-user") == "true"
        ), None)

    def sheet_above_keyboard(label, action_label):
        tree = hierarchy()
        keyboards = [
            item for item in tree
            if "inputmethod" in item.get("package", "")
        ]
        field = visible_input(tree, label)
        action = next((
            item for item in tree.iter("node")
            if item.get("class") == "android.widget.Button"
            and item.get("content-desc") == action_label
        ), None)
        if not keyboards or field is None or action is None:
            return None
        keyboard_top = min(int(re.findall(r"\d+", item.attrib["bounds"])[1]) for item in keyboards)
        controls = {}
        for name, item in ((label, field), (action_label, action)):
            bounds = list(map(int, re.findall(r"\d+", item.attrib["bounds"])))
            assert 0 <= bounds[1] < bounds[3] <= keyboard_top, (name, bounds, keyboard_top)
            controls[name] = bounds
        return {"keyboardTop": keyboard_top, "controls": controls}

    def hide_keyboard():
        state = device.shell("dumpsys input_method").output
        if re.search(r"(?:mInputShown|mIsInputViewShown|isInputViewShown)=true", state):
            device.press("back")

    def shot(name):
        device.screenshot(str(output / f"{name}.png"))
        (output / f"{name}.xml").write_text(device.dump_hierarchy(compressed=False))
        print(f"Screenshot {name}", flush=True)

    try:
        # Refuse occupied ports instead of accidentally testing someone else's server.
        for port in (args.server_port, args.metro_port):
            with socket.socket() as probe:
                assert probe.connect_ex(("127.0.0.1", port)) != 0, f"Port {port} is in use"
        env = {
            **os.environ,
            "PG_DATABASE_URL": f"pglite://{state / 'database'}",
            "STORAGE_URL": f"local:{state / 'storage'}?base_url=/api/storage&upload_url=/api/storage/upload",
            "CI": "1", "BROWSER": "none", "EXPO_OFFLINE": "1",
            "NEXT_TELEMETRY_DISABLED": "1", "EXPO_NO_TELEMETRY": "1",
            "REACT_NATIVE_PACKAGER_HOSTNAME": "127.0.0.1",
        }
        start(["pnpm", "exec", "next", "dev", "-p", str(args.server_port)], "busabase", "server", env)
        # --localhost binds to whichever loopback family the runner resolves
        # first. --host lan listens on all interfaces, including the IPv4 adb
        # reverse target; advertised packager URLs stay on 127.0.0.1 above.
        start(["pnpm", "exec", "expo", "start", "--host", "lan", "--port", str(args.metro_port)], "busabase-mobile", "metro", env)
        def metro_ready():
            with urllib.request.urlopen(metro + "/status", timeout=10) as response:
                return response.read() == b"packager-status:running"
        eventually(metro_ready, "Metro status endpoint", 180)
        # Compile the real branch bundle before starting Android's dev-support
        # packager check; a cold monorepo Metro compile can take several minutes.
        bundle_url = metro + "/.expo/.virtual-metro-entry.bundle?platform=android&dev=true&minify=false"
        try:
            with urllib.request.urlopen(bundle_url, timeout=300) as response:
                bundle = response.read()
                bundle_result = {
                    "url": bundle_url, "status": response.status,
                    "contentType": response.headers.get("content-type"),
                    "bytes": len(bundle), "sha256": hashlib.sha256(bundle).hexdigest(),
                }
        except urllib.error.HTTPError as error:
            failed = error.read()
            (output / "bundle-error.txt").write_bytes(failed[:16000] + b"\n...\n" + failed[-16000:])
            raise
        (output / "bundle.json").write_text(json.dumps(bundle_result, indent=2))
        assert bundle_result["status"] == 200 and len(bundle) > 100000, bundle_result
        print(f"Branch Android bundle ready: {bundle_result['bytes']} bytes", flush=True)
        eventually(lambda: isinstance(http("/api/v1/bases"), list), "local API and migrations", 240)
        base = http("/api/v1/bases", {
            "slug": "native-drive-clients", "name": "Native clients", "autoMerge": True,
            "fields": [
                {"slug": "title", "name": "Client", "type": "text", "required": True},
                {"slug": "files", "name": "Documents", "type": "drive"},
            ],
        })
        record = http(f"/api/v1/bases/{base['id']}/change-requests", {
            "fields": {"title": "Native acceptance client"}, "autoMerge": True,
        })
        assert record.get("materialized") is True, record
        (output / "fixture.json").write_text(json.dumps({"base": base["id"], "record": record["id"]}, indent=2))
        proof = f"Native drive upload: {uuid.uuid4()}\n".encode()
        proof_file = output / "native-proof.txt"
        proof_file.write_bytes(proof)
        adb("reverse", f"tcp:{args.server_port}", f"tcp:{args.server_port}")
        adb("reverse", f"tcp:{args.metro_port}", f"tcp:{args.metro_port}")
        adb("push", str(proof_file), "/sdcard/Download/native-proof.txt")
        device = u2.connect(args.serial)
        device.settings["wait_timeout"] = 120
        device.screen_on()
        adb("shell", "input", "keyevent", "82")
        eventually(lambda: device.app_current().get("package"), "Android launcher")
        shot("00-android-ready")
        adb("install", "-r", str(args.apk.resolve()), timeout=240)
        # Use React Native's developer setting rather than relying on the
        # generated template's default host/port. This changes only test-device
        # connection preferences, never application code or upload behavior.
        preferences = state / "debug-preferences.xml"
        preferences.write_text(
            '<?xml version="1.0" encoding="utf-8"?>\n'
            f'<map><string name="debug_http_host">127.0.0.1:{args.metro_port}</string></map>\n'
        )
        adb("push", str(preferences), "/data/local/tmp/drive-debug-preferences.xml")
        adb("shell", "run-as", app_id, "mkdir", "-p", "shared_prefs")
        adb("shell", "run-as", app_id, "cp", "/data/local/tmp/drive-debug-preferences.xml", f"shared_prefs/{app_id}_preferences.xml")
        # Read the exact developer preference back before launching the UI.
        adb("shell", "run-as", app_id, "cat", f"shared_prefs/{app_id}_preferences.xml")
        adb("reverse", "tcp:8081", f"tcp:{args.metro_port}")
        adb("shell", "am", "start", "-n", f"{app_id}/.MainActivity")
        wait_label("Connect self-hosted", timeout=300)
        shot("01-native-entry")
        tap("Connect self-hosted")
        fill("Busabase server URL", server)
        hide_keyboard()
        tap("Connect")
        wait_label("Open navigation drawer")
        shot("01b-native-connected-home")
        tap("Open navigation drawer")
        tap("Native clients", contains=True)
        # Wait for the Base route to replace Home. Home's activity contains
        # "Create Native acceptance client", which is a different destination.
        wait_label("New record")
        shot("01c-native-base-records")
        tap("Native acceptance client")
        wait_label("Edit record")
        shot("02-native-record")
        tap("Edit record")
        wait_label("New folder")
        record_log = (output / "recording.log").open("wb")
        logs.append(record_log)
        recording = subprocess.Popen([
            *adb_prefix, "shell", "screenrecord", "--time-limit", "180",
            "--bit-rate", "1000000", "/sdcard/drive-story.mp4",
        ], stdout=record_log, stderr=subprocess.STDOUT)
        tap("New folder")
        keyboard_result = eventually(
            lambda: sheet_above_keyboard("Folder name", "Create"),
            "folder input and Create button above the visible Android keyboard", 60,
        )
        fill("Folder name", "Native")
        (output / "keyboard.json").write_text(json.dumps(keyboard_result, indent=2))
        shot("03a-native-folder-with-keyboard")
        hide_keyboard()
        tap("Create")
        wait_label("Native")
        shot("03-native-folder")
        tap("Add file")
        tap("Browse files on this device.")
        eventually(lambda: "documentsui" in device.app_current()["package"], "Android document picker")
        if node("native-proof.txt") is None:
            tap("Show roots")
            tap("Downloads")
        wait_label("native-proof.txt")
        shot("04-android-document-picker")
        tap("native-proof.txt")
        eventually(lambda: device.app_current()["package"] == app_id, "return from native picker")
        wait_label("native-proof.txt")
        shot("05-native-uploaded-file")
        tap("native-proof.txt")
        tap("Rename or move")
        expected_path = "Native/2026/native-proof-final.txt"
        fill("Path", expected_path)
        hide_keyboard()
        tap("Save")
        wait_label("Save change request")
        shot("06-native-moved-file")
        tap("Save change request")

        def saved_reference():
            value = http(f"/api/v1/records/get?recordId={record['id']}")
            refs = value["headCommit"]["payload"].get("files", [])
            return next((ref for ref in refs if ref.get("path") == expected_path), None)

        ref = eventually(saved_reference, "native record save")
        assert ref["fileName"] == "native-proof-final.txt", ref
        raw = http(f"/api/assets/{ref['assetId']}/raw")
        assert raw == proof, "Stored bytes differ from the device's selected file"
        usages = http(f"/api/v1/assets/{ref['assetId']}")["usages"]
        assert any(usage.get("recordId") == record["id"] and usage.get("path") == expected_path for usage in usages), usages
        with args.apk.open("rb") as apk:
            apk_sha256 = hashlib.file_digest(apk, "sha256").hexdigest()
        result = {
            "commit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo, text=True).strip(),
            "runtime": "Android emulator / branch debug APK / SDK56 native modules",
            "appId": app_id, "apkSha256": apk_sha256,
            "recordId": record["id"], "assetId": ref["assetId"], "path": expected_path,
            "bytes": len(proof), "sha256": hashlib.sha256(raw).hexdigest(),
            "nativeDocumentPicker": True, "realByteUpload": True,
            "androidKeyboardSheetVisible": True,
            "savedAndReopened": False, "usageIndexMatches": True,
        }
        (output / "intermediate.json").write_text(json.dumps(result, indent=2))
        wait_label("Edit record")
        wait_label("native-proof-final.txt", contains=True)
        shot("07-native-saved-record")
        tap("Edit record")
        # Wait for the editor, rather than tapping the old read-only page's
        # Native path prefix while the navigation transition is in progress.
        wait_label("Save change request")
        wait_label("New folder")
        tap("Native")
        wait_label("2026")
        tap("2026")
        wait_label("native-proof-final.txt")
        shot("08-native-reopened-folder")
        result["savedAndReopened"] = True
        (output / "result.json").write_text(json.dumps(result, indent=2))
        print(json.dumps(result, indent=2), flush=True)
    finally:
        if device is not None:
            try:
                shot("final-state")
            except Exception as error:
                print(f"Final screenshot unavailable: {error}", flush=True)
        if recording is not None:
            subprocess.run([*adb_prefix, "shell", "pkill", "-2", "screenrecord"], timeout=15, check=False)
            try:
                recording.wait(timeout=15)
                adb("pull", "/sdcard/drive-story.mp4", str(output / "drive-story.mp4"))
            except (subprocess.SubprocessError, OSError) as error:
                print(f"Recording unavailable: {error}", flush=True)
        with (output / "logcat.log").open("wb") as log:
            subprocess.run([*adb_prefix, "logcat", "-d", "-t", "1500"], stdout=log, stderr=subprocess.STDOUT, timeout=30, check=False)
        for process in processes:
            if process.poll() is None:
                try:
                    os.killpg(process.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
        for process in processes:
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
        for log in logs:
            log.close()


if __name__ == "__main__":
    main()
