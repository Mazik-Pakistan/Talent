import asyncio
import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.path.insert(0, '.')

from app.core.database import database

async def check_data():
    tracks = await database.career_tracks.find({}).to_list(100)
    print("Tracks:", len(tracks))
    for t in tracks:
        print(f"  - {t.get('department')}: {t.get('track_name')} (ID: {t['_id']})")
    
    levels = await database.career_levels.find({}).to_list(100)
    print("\nLevels:", len(levels))
    for l in levels:
        print(f"  - Level {l.get('level_number')}: {l.get('role_title')} ({l.get('department')}) ID: {l['_id']}")
    
    assignments = await database.employee_career_assignments.find({}).to_list(100)
    print("\nAssignments:", len(assignments))

asyncio.run(check_data())
