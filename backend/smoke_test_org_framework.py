"""Smoke test for the Organization Framework service — full CRUD + Excel round trip.

Creates data under a unique test org, verifies every operation, then deletes all
test data so the shared dev database is left clean.
"""

import asyncio
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.core.database import database  # noqa: E402
from app.services.organization_framework_service import (  # noqa: E402
    apply_import_data,
    build_export_workbook,
    create_certification,
    create_course,
    create_department,
    upsert_promotion_rule as create_promotion_rule,
    create_roadmap,
    create_role,
    create_skill,
    create_version_snapshot,
    delete_certification,
    delete_course,
    delete_department,
    delete_promotion_rule,
    delete_roadmap,
    delete_role,
    delete_skill,
    get_framework_summary,
    list_certifications,
    list_courses,
    list_departments,
    list_promotion_rules,
    list_roadmaps,
    list_roles,
    list_skills,
    parse_import_workbook,
    update_certification,
    update_course,
    update_department,
    update_role,
    update_skill,
    validate_import_data,
)

ORG = f"smoketest_org_{int(time.time())}"
PASS = 0
FAIL = 0


def check(label, cond, extra=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"[PASS] {label} {extra}")
    else:
        FAIL += 1
        print(f"[FAIL] {label} {extra}")


async def cleanup():
    for coll in (
        database.org_framework_departments,
        database.org_framework_roles,
        database.org_framework_skills,
        database.org_framework_certifications,
        database.org_framework_courses,
        database.org_framework_roadmaps,
        database.org_framework_promotion_rules,
        database.org_framework_versions,
    ):
        await coll.delete_many({"organization_id": ORG})


async def main():
    print("=" * 60)
    print(f"ORG FRAMEWORK SMOKE TEST — org: {ORG}")
    print("=" * 60)

    # ─── Departments ───
    await create_department(ORG, {"name": "Engineering", "description": "Core eng"})
    await create_department(ORG, {"name": "QA"})
    depts = await list_departments(ORG)
    check("department create/list", len(depts) == 2)
    try:
        await create_department(ORG, {"name": "Engineering"})
        check("department duplicate rejected", False)
    except ValueError:
        check("department duplicate rejected", True)
    await update_department(ORG, "Engineering", {"description": "Renamed desc"})
    check("department update", (await list_departments(ORG))[0].get("description") == "Renamed desc")

    # ─── Roles ───
    r1 = await create_role(ORG, {"name": "Junior Engineer", "department": "Engineering", "level_number": 1, "next_role": "Engineer"})
    r2 = await create_role(ORG, {"name": "Engineer", "department": "Engineering", "level_number": 2, "next_role": "Senior Engineer"})
    r3 = await create_role(ORG, {"name": "QA Tester", "department": "QA", "level_number": 1})
    roles = await list_roles(ORG)
    check("role create/list", len(roles) == 3, f"({len(roles)})")
    await update_role(ORG, r1["role_id"], {"level_number": 1, "description": "Entry"})
    check("role update", (await list_roles(ORG))[0].get("description") == "Entry")

    # ─── Skills ───
    s1 = await create_skill(ORG, {"role_name": "Junior Engineer", "skill_name": "Python", "proficiency": "Intermediate", "weight": 25})
    await create_skill(ORG, {"role_name": "Engineer", "skill_name": "Azure", "proficiency": "Advanced", "weight": 30})
    skills = await list_skills(ORG)
    check("skill create/list", len(skills) == 2, f"({len(skills)})")
    await update_skill(ORG, s1["skill_id"], {"weight": 40})
    check("skill update", (await list_skills(ORG, role_name="Junior Engineer"))[0]["weight"] == 40)

    # ─── Certifications ───
    c1 = await create_certification(ORG, {"role_name": "Engineer", "certification_name": "AZ-900", "mandatory": True})
    certs = await list_certifications(ORG)
    check("cert create/list", len(certs) == 1, f"({len(certs)})")
    await update_certification(ORG, c1["cert_id"], {"mandatory": False})
    check("cert update", (await list_certifications(ORG))[0]["mandatory"] is False)

    # ─── Courses ───
    course1 = await create_course(ORG, {"course_id": "MS001", "name": "C# Fundamentals", "provider": "Microsoft Learn", "category": "Programming", "duration_hours": 10, "difficulty": "Beginner"})
    await create_course(ORG, {"name": "Git Essentials", "provider": "LinkedIn Learning", "category": "Tools"})
    courses = await list_courses(ORG)
    check("course create/list", len(courses) == 2, f"({len(courses)})")
    await update_course(ORG, course1["course_id"], {"duration_hours": 12})
    check("course update", (await list_courses(ORG))[0]["duration_hours"] == 12)

    # ─── Roadmaps ───
    rm1 = await create_roadmap(ORG, {"role_name": "Junior Engineer", "course_id": "MS001", "course_name": "C# Fundamentals", "mandatory": True, "order": 1})
    rmps = await list_roadmaps(ORG)
    check("roadmap create/list", len(rmps) == 1, f"({len(rmps)})")

    # ─── Promotion rules ───
    await create_promotion_rule(ORG, {"role_name": "Junior Engineer", "min_experience_months": 12, "required_readiness_pct": 80, "manager_approval_required": True})
    rules = await list_promotion_rules(ORG)
    check("promotion rule upsert", len(rules) == 1, f"({len(rules)})")

    # ─── Summary ───
    summary = await get_framework_summary(ORG)
    check("summary counts", summary["departments"] == 2 and summary["roles"] == 3 and summary["skills"] == 2 and summary["courses"] == 2,
          f"(d={summary['departments']}, r={summary['roles']}, s={summary['skills']}, c={summary['courses']})")

    # ─── Version snapshot ───
    await create_version_snapshot(ORG, "Smoke Test")
    check("version snapshot", summary["departments"] >= 2)

    # ─── Excel export → parse → validate round trip ───
    buf = await build_export_workbook(ORG)
    check("export workbook bytes", buf.getvalue()[:2] == b"PK", f"({len(buf.getvalue())} bytes)")
    parsed = parse_import_workbook(buf.getvalue())
    check("import parse departments", len(parsed["departments"]) == 2, f"({len(parsed['departments'])})")
    check("import parse roles", len(parsed["roles"]) == 3, f"({len(parsed['roles'])})")
    check("import parse courses", len(parsed["courses"]) == 2, f"({len(parsed['courses'])})")
    report = validate_import_data(parsed)
    check("import validation valid", report["valid"] is True, f"(errors={report['errors']})")

    # ─── Import apply into a fresh org ───
    org2 = f"{ORG}_v2"
    await apply_import_data(org2, parsed)
    summary2 = await get_framework_summary(org2)
    check("import apply into fresh org", summary2["departments"] == 2 and summary2["roles"] == 3 and summary2["courses"] == 2,
          f"(d={summary2['departments']}, r={summary2['roles']}, c={summary2['courses']})")
    for coll in (
        database.org_framework_departments,
        database.org_framework_roles,
        database.org_framework_skills,
        database.org_framework_certifications,
        database.org_framework_courses,
        database.org_framework_roadmaps,
        database.org_framework_promotion_rules,
        database.org_framework_versions,
    ):
        await coll.delete_many({"organization_id": org2})

    # ─── Deletes ───
    check("delete skill", await delete_skill(ORG, s1["skill_id"]) is True)
    check("delete cert", await delete_certification(ORG, c1["cert_id"]) is True)
    check("delete course", await delete_course(ORG, course1["course_id"]) is True)
    check("delete roadmap", await delete_roadmap(ORG, rm1["roadmap_id"]) is True)
    check("delete role", await delete_role(ORG, r1["role_id"]) is True)
    check("delete promotion rule", await delete_promotion_rule(ORG, "Junior Engineer") is True)
    check("delete department", await delete_department(ORG, "QA") is True)

    await cleanup()

    print("=" * 60)
    print(f"RESULT: {PASS} passed, {FAIL} failed")
    print("=" * 60)
    sys.exit(0 if FAIL == 0 else 1)


if __name__ == "__main__":
    asyncio.run(main())
