"""Comprehensive test for Career Framework functionality."""

import asyncio
import sys
import os
import io

# Force UTF-8 output
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.core.database import database
from app.services.career_framework_service import career_framework_service


class MockUser:
    def __init__(self, user_id="test_recruiter_001", role="recruiter", full_name="Test Recruiter", email="test@talentai.com"):
        self.id = user_id
        self.role = role
        self.full_name = full_name
        self.email = email


async def test_career_track_creation():
    print("\n" + "="*60)
    print("TEST 1: Career Track Creation")
    print("="*60)

    user = MockUser()

    try:
        result = await career_framework_service.create_track(
            current_user=user,
            department="AI",
            track_name="AI Engineering",
            description="AI department career progression"
        )
        print(f"[PASS] Created track: {result['track_name']} for department: {result['department']}")
        print(f"       Track ID: {result['id']}")
        return result['id']
    except Exception as e:
        print(f"[FAIL] Failed to create track: {e}")
        return None


async def test_career_level_creation(track_id=None):
    print("\n" + "="*60)
    print("TEST 2: Career Level Creation")
    print("="*60)

    user = MockUser()

    levels_to_create = [
        {
            "department": "AI",
            "track_name": "AI Engineering",
            "level_number": 1,
            "role_title": "Junior Solution Engineer/System Analyst",
            "required_skills": [
                {"skill": "Python", "proficiency": "Intermediate", "weight": 20},
                {"skill": "Machine Learning", "proficiency": "Beginner", "weight": 15}
            ],
            "required_certifications": [],
            "learning_path": [
                {"course_uid": "ms-learn-python-101", "course_title": "Python Fundamentals", "source": "microsoft_learn", "mandatory": True, "order": 1},
                {"course_uid": "ms-learn-ml-101", "course_title": "Introduction to ML", "source": "microsoft_learn", "mandatory": True, "order": 2}
            ],
            "min_experience_years": 0,
            "min_time_in_current_role_months": 0,
            "description": "Entry-level AI position"
        },
        {
            "department": "AI",
            "track_name": "AI Engineering",
            "level_number": 2,
            "role_title": "Solution Engineer/System Analyst",
            "required_skills": [
                {"skill": "Python", "proficiency": "Advanced", "weight": 25},
                {"skill": "Machine Learning", "proficiency": "Intermediate", "weight": 20},
                {"skill": "TensorFlow", "proficiency": "Beginner", "weight": 15}
            ],
            "required_certifications": [
                {"certification": "Azure AI Fundamentals (AI-900)", "mandatory": True}
            ],
            "learning_path": [
                {"course_uid": "ms-learn-python-201", "course_title": "Advanced Python", "source": "microsoft_learn", "mandatory": True, "order": 1},
                {"course_uid": "ms-learn-ml-201", "course_title": "ML Deep Dive", "source": "microsoft_learn", "mandatory": True, "order": 2},
                {"course_uid": "ms-learn-ai-900", "course_title": "Azure AI Fundamentals", "source": "microsoft_learn", "mandatory": True, "order": 3}
            ],
            "min_experience_years": 1.5,
            "min_time_in_current_role_months": 12,
            "manager_approval_required": True,
            "description": "Mid-level AI position"
        },
        {
            "department": "AI",
            "track_name": "AI Engineering",
            "level_number": 3,
            "role_title": "Senior Solution Engineer/System Analyst",
            "required_skills": [
                {"skill": "Python", "proficiency": "Expert", "weight": 30},
                {"skill": "Machine Learning", "proficiency": "Advanced", "weight": 25},
                {"skill": "Deep Learning", "proficiency": "Intermediate", "weight": 20}
            ],
            "required_certifications": [
                {"certification": "Azure AI Engineer Associate", "mandatory": True}
            ],
            "learning_path": [
                {"course_uid": "ms-learn-dl-301", "course_title": "Deep Learning Specialization", "source": "microsoft_learn", "mandatory": True, "order": 1},
                {"course_uid": "ms-learn-ai-102", "course_title": "Azure AI Engineer", "source": "microsoft_learn", "mandatory": True, "order": 2}
            ],
            "min_experience_years": 3,
            "min_time_in_current_role_months": 12,
            "description": "Senior-level AI position"
        }
    ]

    created_levels = []
    for level_data in levels_to_create:
        try:
            result = await career_framework_service.create_level(
                current_user=user,
                **level_data
            )
            print(f"[PASS] Created Level {result['level_number']}: {result['role_title']}")
            print(f"       Skills: {len(result['required_skills'])} | Certs: {len(result['required_certifications'])} | Courses: {len(result['learning_path'])}")
            created_levels.append(result)
        except Exception as e:
            print(f"[FAIL] Failed to create Level {level_data['level_number']}: {e}")

    return created_levels


async def test_list_tracks():
    print("\n" + "="*60)
    print("TEST 3: List Career Tracks")
    print("="*60)

    try:
        result = await career_framework_service.list_tracks()
        tracks = result.get('tracks', [])
        print(f"[PASS] Found {len(tracks)} career track(s)")
        for track in tracks:
            print(f"       - {track['department']}: {track['track_name']} ({len(track.get('levels', []))} levels)")
        return tracks
    except Exception as e:
        print(f"[FAIL] Failed to list tracks: {e}")
        return []


async def test_list_levels():
    print("\n" + "="*60)
    print("TEST 4: List Career Levels")
    print("="*60)

    try:
        result = await career_framework_service.list_levels()
        levels = result.get('levels', [])
        print(f"[PASS] Found {len(levels)} career level(s)")
        for level in levels:
            print(f"       - Level {level['level_number']}: {level['role_title']} ({level['department']})")
        return levels
    except Exception as e:
        print(f"[FAIL] Failed to list levels: {e}")
        return []


async def test_csv_export():
    print("\n" + "="*60)
    print("TEST 5: CSV Export")
    print("="*60)

    try:
        csv_content = await career_framework_service.export_framework_csv()
        lines = csv_content.strip().split('\n')
        print(f"[PASS] Exported CSV with {len(lines)} rows (including header)")
        print(f"       Header: {lines[0][:80]}...")
        if len(lines) > 1:
            print(f"       First data row: {lines[1][:80]}...")
        return csv_content
    except Exception as e:
        print(f"[FAIL] Failed to export CSV: {e}")
        return None


async def test_csv_import():
    print("\n" + "="*60)
    print("TEST 6: CSV Import")
    print("="*60)

    user = MockUser()

    csv_content = """Department,Track Name,Level,Role Title,Required Skills,Required Certifications,Learning Path Courses,Competencies,Min Experience (Years),Min Time in Role (Months),Manager Approval Required,Description
QA,QA Career Path,1,Junior QA Engineer,Testing (Beginner); Python (Beginner),,Testing Fundamentals; Python Basics,Attention to Detail (30%),0,0,No,Entry-level QA
QA,QA Career Path,2,QA Engineer,Testing (Intermediate); Python (Intermediate); Selenium (Beginner),ISTQB Foundation,Advanced Testing; Python for QA; Selenium Basics,Automation Skills (30%),1.5,12,Yes,Mid-level QA
Finance,Finance Career Path,1,Junior Accountant,Accounting (Beginner); Excel (Beginner),,Accounting Basics; Excel Fundamentals,Attention to Detail (25%),0,0,No,Entry-level Finance"""

    try:
        result = await career_framework_service.import_framework_csv(user, csv_content)
        print(f"[PASS] Import completed: {result['imported']} imported, {result['skipped']} skipped")
        if result.get('errors'):
            print(f"       Errors: {len(result['errors'])}")
            for err in result['errors'][:3]:
                print(f"         - Row {err.get('row')}: {err.get('error')}")
        return result
    except Exception as e:
        print(f"[FAIL] Failed to import CSV: {e}")
        return None


async def test_employee_assignment():
    print("\n" + "="*60)
    print("TEST 7: Employee Career Assignment")
    print("="*60)

    user = MockUser()

    levels_result = await career_framework_service.list_levels()
    levels = levels_result.get('levels', [])

    if not levels:
        print("[SKIP] No levels found")
        return None

    target_level = levels[0]
    print(f"       Target level: Level {target_level['level_number']}: {target_level['role_title']}")

    try:
        result = await career_framework_service.assign_career(
            current_user=user,
            employee_id="EMP-000001",
            target_level_id=target_level['id'],
            target_date=None
        )
        print(f"[PASS] Assigned career path to employee")
        print(f"       Employee: {result.get('employee_name')}")
        print(f"       Target: {result.get('target_role_title')}")
        print(f"       Learning Path: {len(result.get('assigned_learning_path', []))} courses")
        return result
    except Exception as e:
        print(f"[INFO] Assignment result: {e}")
        return None


async def test_promotion_readiness():
    print("\n" + "="*60)
    print("TEST 8: Promotion Readiness Report")
    print("="*60)

    user = MockUser()

    try:
        result = await career_framework_service.get_promotion_readiness(user)
        ready = result.get('ready', [])
        almost_ready = result.get('almost_ready', [])
        behind = result.get('behind', [])
        total = result.get('total_count', 0)

        print(f"[PASS] Promotion Readiness Report:")
        print(f"       Total employees with career paths: {total}")
        print(f"       Ready for promotion (80%+): {len(ready)}")
        print(f"       Almost ready (50-79%): {len(almost_ready)}")
        print(f"       Behind schedule (<50%): {len(behind)}")

        return result
    except Exception as e:
        print(f"[FAIL] Failed to get promotion readiness: {e}")
        return None


async def test_career_progress_report():
    print("\n" + "="*60)
    print("TEST 9: Career Progress Report")
    print("="*60)

    user = MockUser()

    try:
        result = await career_framework_service.get_career_progress_report(user)
        by_dept = result.get('by_department', [])

        print(f"[PASS] Career Progress Report:")
        print(f"       Total employees: {result.get('total_employees', 0)}")
        print(f"       On track: {result.get('total_on_track', 0)}")
        print(f"       Behind: {result.get('total_behind', 0)}")

        if by_dept:
            print(f"\n       By Department:")
            for dept in by_dept:
                print(f"       - {dept['department']}: {dept['total_employees']} employees, avg readiness: {dept['avg_readiness_score']}%")

        return result
    except Exception as e:
        print(f"[FAIL] Failed to get career progress report: {e}")
        return None


async def run_all_tests():
    print("\n" + "="*60)
    print("CAREER FRAMEWORK - COMPREHENSIVE TEST SUITE")
    print("="*60)

    results = {}

    track_id = await test_career_track_creation()
    results['track_creation'] = track_id is not None

    levels = await test_career_level_creation(track_id)
    results['level_creation'] = len(levels) > 0

    tracks = await test_list_tracks()
    results['list_tracks'] = len(tracks) > 0

    all_levels = await test_list_levels()
    results['list_levels'] = len(all_levels) > 0

    csv_export = await test_csv_export()
    results['csv_export'] = csv_export is not None

    import_result = await test_csv_import()
    results['csv_import'] = import_result is not None and import_result.get('imported', 0) > 0

    assignment = await test_employee_assignment()
    results['employee_assignment'] = assignment is not None

    readiness = await test_promotion_readiness()
    results['promotion_readiness'] = readiness is not None

    progress = await test_career_progress_report()
    results['career_progress_report'] = progress is not None

    print("\n" + "="*60)
    print("TEST RESULTS SUMMARY")
    print("="*60)

    passed = sum(1 for v in results.values() if v)
    total = len(results)

    for test_name, passed_test in results.items():
        status = "[PASS]" if passed_test else "[FAIL]"
        print(f"  {status}: {test_name}")

    print(f"\n{'='*60}")
    print(f"Total: {passed}/{total} tests passed")
    print(f"{'='*60}\n")

    return results


if __name__ == "__main__":
    asyncio.run(run_all_tests())
