import asyncio
from datetime import datetime, timezone

from app.core.database import database


async def main():
    today = datetime.now(timezone.utc).date()
    print('today', today)

    employees = await database.employees.find({'start_date': {'$gte': today.isoformat()}}).to_list(length=None)
    print('employees_future', len(employees))
    for e in employees:
        print('EMP', e.get('full_name'), e.get('status'), e.get('start_date'), e.get('recruiter_id'), e.get('conversion_status'))

    candidates = await database.candidates.find({'conversion_status': 'offer_signed', 'start_date': {'$gte': today.isoformat()}}).to_list(length=None)
    print('signed_candidates_future', len(candidates))
    for c in candidates:
        print('CAND', c.get('full_name'), c.get('status'), c.get('conversion_status'), c.get('start_date'), c.get('recruiter_id'))

    offers = await database.offer_letters.find({'status': 'signed'}).to_list(length=None)
    print('signed_offers', len(offers))
    for o in offers:
        print('OFFER', o.get('candidate_name'), o.get('start_date'), o.get('candidate_id'))

asyncio.run(main())
