import sys
import io
import os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv
load_dotenv()

from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

print("="*60)
print("API ENDPOINT TESTS")
print("="*60)

# Test 1: GET tracks
print("\n1. GET /api/career-framework/tracks")
resp = client.get("/api/career-framework/tracks")
print(f"   Status: {resp.status_code}")
if resp.status_code == 200:
    tracks = resp.json().get("tracks", [])
    print(f"   Found {len(tracks)} tracks")
else:
    print(f"   Error: {resp.text[:200]}")

# Test 2: GET levels
print("\n2. GET /api/career-framework/levels")
resp = client.get("/api/career-framework/levels")
print(f"   Status: {resp.status_code}")
if resp.status_code == 200:
    levels = resp.json().get("levels", [])
    print(f"   Found {len(levels)} levels")
else:
    print(f"   Error: {resp.text[:200]}")

# Test 3: POST create track
print("\n3. POST /api/career-framework/tracks")
resp = client.post("/api/career-framework/tracks", json={
    "department": "IT",
    "track_name": "IT Infrastructure",
    "description": "IT department career path"
})
print(f"   Status: {resp.status_code}")
if resp.status_code == 200:
    track = resp.json()
    print(f"   Created: {track.get('track_name')} (ID: {track.get('id')})")
    track_id = track.get('id')
else:
    print(f"   Error: {resp.text[:200]}")
    track_id = None

# Test 4: POST create level
print("\n4. POST /api/career-framework/levels")
resp = client.post("/api/career-framework/levels", json={
    "department": "IT",
    "track_name": "IT Infrastructure",
    "level_number": 1,
    "role_title": "Junior IT Specialist",
    "required_skills": [
        {"skill": "Networking", "proficiency": "Beginner", "weight": 20}
    ],
    "required_certifications": [],
    "learning_path": [
        {"course_uid": "ms-learn-net-101", "course_title": "Networking Fundamentals", "source": "microsoft_learn", "mandatory": True, "order": 1}
    ],
    "min_experience_years": 0,
    "min_time_in_current_role_months": 0
})
print(f"   Status: {resp.status_code}")
if resp.status_code == 200:
    level = resp.json()
    print(f"   Created: Level {level.get('level_number')}: {level.get('role_title')} (ID: {level.get('id')})")
    level_id = level.get('id')
else:
    print(f"   Error: {resp.text[:200]}")
    level_id = None

# Test 5: GET export
print("\n5. GET /api/career-framework/export")
resp = client.get("/api/career-framework/export")
print(f"   Status: {resp.status_code}")
if resp.status_code == 200:
    lines = resp.content.decode().strip().split('\n')
    print(f"   Exported {len(lines)} rows")
else:
    print(f"   Error: {resp.text[:200]}")

# Test 6: GET reports
print("\n6. GET /api/career-framework/reports/promotion-readiness")
resp = client.get("/api/career-framework/reports/promotion-readiness")
print(f"   Status: {resp.status_code}")
if resp.status_code == 200:
    data = resp.json()
    print(f"   Total: {data.get('total_count', 0)}")
else:
    print(f"   Error: {resp.text[:200]}")

print("\n" + "="*60)
print("ALL API TESTS COMPLETE")
print("="*60)
