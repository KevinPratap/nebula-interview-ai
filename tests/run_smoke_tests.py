#!/usr/bin/env python3
"""Nebula smoke tests — no pytest, no third-party deps required. Run: python3 tests/run_smoke_tests.py"""
import sys
import os
import tempfile
import shutil
import json

# Make sure repo root is on path
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, REPO_ROOT)

passed = 0
failed = 0

def ok(name: str):
    global passed
    passed += 1
    print(f"  PASS: {name}")

def fail(name: str, reason: str):
    global failed
    failed += 1
    print(f"  FAIL: {name} — {reason}")


# ──────────────────────────────────────────────────────────────────────────────
# SUITE 1: SettingsManager
# ──────────────────────────────────────────────────────────────────────────────
print("\n=== Suite 1: SettingsManager ===")
tmp_dir = tempfile.mkdtemp(prefix="nebula_test_")
try:
    os.environ["NEBULA_USER_DATA"] = tmp_dir
    from core.settings_manager import SettingsManager

    # 1a. Writes to NEBULA_USER_DATA
    sm = SettingsManager()
    expected_path = os.path.join(tmp_dir, "user_settings.json")
    if sm.filename == expected_path:
        ok("Settings file path resolves to NEBULA_USER_DATA")
    else:
        fail("Settings file path resolves to NEBULA_USER_DATA", f"got {sm.filename}")

    # 1b. Legacy key normalization
    legacy = {"groq_key": "gsk_test123", "theme": "Nebula Dark"}
    with open(sm.filename, "w", encoding="utf-8") as f:
        json.dump(legacy, f)
    sm2 = SettingsManager()
    if sm2.get("groq_api_key") == "gsk_test123":
        ok("Legacy groq_key normalized to groq_api_key")
    else:
        fail("Legacy groq_key normalized to groq_api_key", f"got {sm2.get('groq_api_key')}")

    # 1c. UTF-8 roundtrip with non-ASCII
    sm2.set("test_unicode", "Ünïcödé 🚀 日本語")
    sm3 = SettingsManager()
    if sm3.get("test_unicode") == "Ünïcödé 🚀 日本語":
        ok("UTF-8 roundtrip with non-ASCII value")
    else:
        fail("UTF-8 roundtrip with non-ASCII value", f"got {sm3.get('test_unicode')}")

finally:
    shutil.rmtree(tmp_dir, ignore_errors=True)
    os.environ.pop("NEBULA_USER_DATA", None)


# ──────────────────────────────────────────────────────────────────────────────
# SUITE 2: TranscriptManager
# ──────────────────────────────────────────────────────────────────────────────
print("\n=== Suite 2: TranscriptManager ===")
tmp_dir = tempfile.mkdtemp(prefix="nebula_transcript_test_")
try:
    from core.transcript_manager import TranscriptManager

    # 2a. notes_dir override + single file on end_session
    notes_dir = os.path.join(tmp_dir, "meeting_notes")
    tm = TranscriptManager(notes_dir=notes_dir)
    tm.start_session("Test Interview")
    tm.add_entry("What is O(n log n)? Please explain.", "Internal Audio")
    tm.add_entry("It's the time complexity of merge sort and heap sort.", "Internal Audio")
    path = tm.end_session()
    files_after_end = [f for f in os.listdir(notes_dir) if f.endswith(".md")]
    if len(files_after_end) == 1:
        ok("end_session writes exactly one .md file")
    else:
        fail("end_session writes exactly one .md file", f"found {len(files_after_end)} files")

    # 2b. File contains entry text and is valid UTF-8
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    if "O(n log n)" in content:
        ok("Transcript file contains entry text")
    else:
        fail("Transcript file contains entry text", "entry text not found in file")

    # 2c. generate_meeting_notes with existing_path does NOT write a second file
    count_before = len([f for f in os.listdir(notes_dir) if f.endswith(".md")])
    result = tm.generate_meeting_notes(groq_key="", title="Test", existing_path=path)
    count_after = len([f for f in os.listdir(notes_dir) if f.endswith(".md")])
    if count_after == count_before:
        ok("generate_meeting_notes with existing_path does not write a second file")
    else:
        fail("generate_meeting_notes with existing_path does not write a second file",
             f"file count went from {count_before} to {count_after}")

    # 2d. UTF-8 encoding in notes file (emoji survives)
    tm2 = TranscriptManager(notes_dir=notes_dir)
    tm2.start_session("Emoji Test 🚀")
    tm2.add_entry("Testing emoji: 🎯 and unicode: Ünïcödé", "Internal Audio")
    path2 = tm2.end_session()
    with open(path2, "r", encoding="utf-8") as f:
        content2 = f.read()
    if "🎯" in content2 and "Ünïcödé" in content2:
        ok("Transcript file correctly handles UTF-8 and emoji")
    else:
        fail("Transcript file correctly handles UTF-8 and emoji", "emoji or unicode not found in file")

finally:
    shutil.rmtree(tmp_dir, ignore_errors=True)


# ──────────────────────────────────────────────────────────────────────────────
# SUITE 3: Junk Filter (core.transcript_filter)
# ──────────────────────────────────────────────────────────────────────────────
print("\n=== Suite 3: Junk Filter ===")
try:
    from core.transcript_filter import is_junk

    cases = [
        ("What is O(n log n)?", False, "Coding question with O(n log n) is NOT junk"),
        ("[music]", True, "[music] IS junk"),
        ("(applause)", True, "(applause) IS junk"),
        ("thanks for watching", True, "'thanks for watching' short IS junk"),
        ("Please explain the difference between supervised and unsupervised learning", False,
         "Full ML question is NOT junk"),
        ("What is the time complexity of quicksort in the worst case?", False, "Quicksort question is NOT junk"),
        ("Can you walk me through how you would implement a binary search tree?", False, "BST question is NOT junk"),
    ]

    for text, expected, label in cases:
        result = is_junk(text)
        if result == expected:
            ok(label)
        else:
            fail(label, f"is_junk({text!r}) returned {result}, expected {expected}")

except ImportError as e:
    fail("Import core.transcript_filter", str(e))


# ──────────────────────────────────────────────────────────────────────────────
# Results
# ──────────────────────────────────────────────────────────────────────────────
print(f"\n{'='*50}")
print(f"Results: {passed} passed, {failed} failed")
if failed > 0:
    print("SOME TESTS FAILED")
    sys.exit(1)
else:
    print("ALL TESTS PASSED")
    sys.exit(0)
