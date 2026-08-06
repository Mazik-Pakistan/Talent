# TalentAI - Complete System Summary

> Last Updated: August 6, 2026

---

## Table of Contents
1. [System Overview](#system-overview)
2. [Roles & Permissions](#roles--permissions)
3. [Super Admin Features](#super-admin-features)
4. [Recruiter Features](#recruiter-features)
5. [Employee Features](#employee-features)
6. [Candidate Features](#candidate-features)
7. [Learning Management System (LMS)](#learning-management-system-lms)
8. [Career Framework](#career-framework)
9. [Technical Architecture](#technical-architecture)

---

## System Overview

TalentAI is a **product-as-a-service platform** for managing talent lifecycle — from recruitment to employee development. It uses a multi-tenant architecture where:

- **Super Admin** = Product owner managing the TalentAI platform
- **Super Admin invites Recruiters** and assigns them capabilities/modules
- **Recruiters** manage their organization's talent (candidates, employees, learning, etc.)
- **Candidates** go through onboarding and become employees
- **Employees** use the platform for learning, career development, and HR tasks

### Tech Stack
- **Backend:** Python (FastAPI) + MongoDB
- **Frontend:** Next.js (React) + CSS Modules
- **AI:** Gemini (Google AI) for recommendations, skill assessment, career paths
- **Storage:** Cloudinary for file uploads
- **Email:** SMTP for notifications

---

## Roles & Permissions

### Role Hierarchy
```
super_admin → recruiter → employee → candidate
```

### Capabilities (Recruiter-Specific Modules)
| Capability | Description |
|-----------|-------------|
| `recruitment` | View and manage candidates |
| `invite` | Send invitations and offer letters |
| `employees` | Manage employee directory and profiles |
| `documents` | Document management and verification |
| `learning` | Learning management system access |
| `announcements` | Create and manage announcements |
| `it` | IT provisioning and service requests |
| `messages` | Internal messaging system |
| `reporting` | Activity logs and analytics |
| `profile` | Profile management |

### Access Control
- **Backend:** `@require_permissions()`, `@require_capabilities()`, `@require_roles()` decorators
- **Frontend:** `ProtectedRecruiterRoute`, `RequireAccess` components
- **Capabilities:** Stored on recruiter profile, enforced per-module (but enforcement was a known gap)

---

## Super Admin Features

### Dashboard
- Overview of all recruiters, organizations, and platform metrics

### Recruiter Management
- **Invite Recruiters:** Send email invitations with assigned capabilities
- **Manage Capabilities:** Enable/disable modules per recruiter
- **View All Recruiters:** List with capabilities, status, organization
- **Bulk Operations:** Multiple recruiter management

### Platform Management
- Organization management (multi-tenancy)
- System-wide announcements
- Audit logging of all actions

---

## Recruiter Features

### 1. Overview Dashboard
- Key metrics: candidates, employees, pending tasks
- Recent activity feed
- Quick actions and shortcuts

### 2. Candidate Management
- **Candidate Directory:** View all candidates with filters
- **Onboarding Progress:** Track candidate onboarding completion
- **Reminders:** Send onboarding reminders via email + notification
- **Ready for Conversion:** Candidates with signed offers ready for activation

### 3. Invite & Offer Management
- **Send Invitations:** Email invitations to candidates
- **Offer Letters:** Create, send, track offer letters
- **Offer Negotiation:** Salary negotiation workflow
- **Offer Validity:** Extend offer validity periods
- **Digital Signatures:** Candidates sign offers electronically

### 4. Employee Management
- **Employee Directory:** Full employee listing with search/filter
- **Employee Profiles:** Detailed employee information
- **Career Timeline:** Track promotions, transfers, exits
- **Banking Details:** Manage payroll information (on-site employees)
- **CSV Export:** Export employee data

### 5. Learning Management (LMS)

#### Course Catalog (3 Sources)
| Source | Type | Description |
|--------|------|-------------|
| LinkedIn Learning | Managed | Imported roadmap courses by designation |
| Microsoft Learn | Technical | Learning paths, modules, certifications |
| Coursera | Soft Skills | Communication, leadership, etc. |

#### Course Assignment
- Assign to individuals, departments, designations, or by skills
- Set due dates, mandatory flags, notes
- Auto-due date calculation based on course duration
- Email + notification on assignment

#### Track Progress
- View all assignments with status (assigned/in_progress/completed)
- Filter by status, mandatory only
- Send reminders to employees

#### Certificate Verification
- Review pending certificates uploaded by employees
- Approve/reject with notes
- AI extracts skills from verified certificates
- Skills automatically added to employee profile

#### Knowledge Base
- Define organizational roles with required skills/certifications
- Roles drive career matching and skill gap analysis

#### Managed Learning (LinkedIn)
- Import courses from Excel/CSV
- Manage course catalog (create, edit, archive, delete)
- Course hierarchy view (designation → month → category → competency)

#### Learning Analytics
- Department-wise completion rates
- Popular courses
- Monthly trends
- Mandatory training compliance

### 6. Career Framework

#### Career Track Management
- Define career progression tracks per department
- 9 departments: MBS, Innovations, QA, AI, HR, Finance, IT, Infra, Odyssey

#### Career Level Definition
For each level, define:
- **Required Skills:** Skill name + proficiency level + weight
- **Required Certifications:** Certification name + mandatory flag
- **Learning Path:** Ordered list of courses (from catalog)
- **Competencies:** Assessment criteria with weights
- **Eligibility:** Min experience, min time in role, manager approval

#### Designation Hierarchy
```
Level 1:  Junior Solution Engineer/System Analyst
Level 2:  Solution Engineer/System Analyst
Level 3:  Senior Solution Engineer/System Analyst
Level 4:  Associate Consultant
Level 5:  Consultant
Level 6:  Senior Consultant
Level 7:  Managing Consultant
Level 8:  Principal Consultant
Level 9:  Architect
```

#### Employee Career Assignment
- Assign career path to employees
- Set target level and target date
- Auto-generate learning path from level requirements
- Track progress toward promotion

#### Promotion Readiness
- **Ready (80%+):** Eligible for promotion
- **Almost Ready (50-79%):** Making progress
- **Behind (<50%):** Needs attention
- Readiness score calculated from courses, skills, certifications

#### CSV Import/Export
- Download CSV template
- Bulk import career framework from Excel
- Export existing framework as backup

### 7. Employee Career Assignment

#### Assign Career Path
- Select employee from directory
- Choose target level (next promotion)
- Set target date
- System auto-populates learning path

#### Track Progress
- View all assigned career paths
- See readiness scores per employee
- Filter by department

### 8. IT Management
- **IT Provisioning:** Request equipment, licenses, company email
- **IT Kits:** Pre-configured equipment bundles
- **IT Service Requests:** Employee IT support tickets
- **Batch Processing:** Bulk IT provisioning

### 9. Announcements
- Create organization-wide announcements
- Target by department, role, or all
- Schedule publication

### 10. Messages
- Internal messaging between recruiter and employees
- Thread-based conversations
- Read/unread tracking

### 11. Activity & Reporting
- Activity logs for all actions
- Audit trail for compliance
- Export reports

### 12. AI Assistant
- Context-aware chatbot
- Suggests actions based on current module
- Helps with common tasks
- Mascot with proactive suggestions

---

## Employee Features

### 1. Dashboard
- Welcome hero with key metrics
- Recent activity
- Quick actions

### 2. Onboarding
- **Profile Completion:** Step-by-step profile setup
  - Emergency contact
  - Bank & payroll details (remote employees)
  - Professional references
  - Company policy acknowledgment
  - Self declaration (NDA)
- Progress tracking
- Reminder notifications

### 3. Documents
- View uploaded documents
- Document verification status

### 4. Learning Management

#### Overview Tab
- Stats: To start, In Progress, Completed, Certificates
- Recent activity
- Assigned courses waiting to start

#### Course Catalog
- Browse 3 sources (LinkedIn, Microsoft, Coursera)
- Filter by role, level, type, category
- Bookmark courses
- Start learning (redirects to provider)
- AI-recommended courses highlighted

#### My Learning
- All enrolled courses with progress
- Filter by status
- Open course / Update progress (+25%)
- Assigned courses not yet started

#### Skill Profile
- Manual skill entry (name, category, proficiency, years)
- AI skill assessment from resume
- Skills merged from: resume, certifications, manual
- Verification status per skill
- Role fit percentage
- Gap analysis

#### Career Path
- **Career Progression Ladder:** Visual ladder from Knowledge Base roles
  - Current position highlighted
  - Next step identified
  - Missing skills/certs shown
  - Progress percentage per level
- **Career Goal & Skill Gap:**
  - Set target role
  - AI analyzes gap against Knowledge Base
  - Readiness ring visualization
  - Missing skills in priority order
  - Missing certifications
- **Learning Path:** AI-generated step-by-step courses toward goal
- **Course Recommendations:** AI-ranked based on gaps

#### Certificates
- Upload completion certificates (PDF, PNG, JPG)
- Edit pending certificates
- View verification status
- Delete rejected certificates

### 5. My Career (NEW)
- **Assigned Career Path:** View recruiter-assigned progression
- **Progress Ring:** Overall readiness visualization
- **Required Learning:** Courses with status (completed/in_progress/not_started)
- **Skills to Acquire:** Current vs target proficiency
- **Certifications to Earn:** Status tracking
- **Eligibility Check:** Checklist of requirements
- **Career Discussions:** History with recruiter

### 6. My Talent
- Internal opportunities
- Competency evaluations
- Development plans

### 7. AI Assistant
- Context-aware guidance
- Page-specific suggestions
- Navigate between sections

### 8. IT Support
- Submit IT service requests
- Track request status

### 9. Messages
- Message HR/recruiter
- Thread-based conversations

### 10. Profile
- View/edit personal information
- Profile photo management

---

## Candidate Features

### 1. Onboarding Flow
- **Personal Information:** Name, contact, ID documents
- **Education:** University, degree, GPA
- **Skills & Certifications:** Technical skills, certifications
- **Government ID:** Passport/national ID upload
- **Resume/CV:** Upload and parse

### 2. Offer Management
- View offer letters
- Digital signature
- Salary negotiation
- Accept/decline

### 3. Documents
- Upload required documents
- Track verification status

### 4. Profile
- Complete profile before conversion
- Track onboarding progress

---

## Learning Management System (LMS)

### Data Flow
```
1. Recruiter defines Knowledge Base (roles + required skills/certs)
2. Employee browses catalog → Starts course → Redirected to provider
3. Employee completes course → Returns → Uploads certificate
4. Recruiter verifies certificate → AI extracts skills → Skill matrix updates
5. Skills + progress feed into career path readiness
```

### MongoDB Collections
| Collection | Purpose |
|-----------|---------|
| `learning_enrollments` | Course enrollments with progress |
| `learning_assignments` | Recruiter-assigned courses |
| `learning_bookmarks` | Employee course bookmarks |
| `learning_certificates` | Uploaded certificates |
| `learning_courses` | Managed roadmap courses |
| `employee_skills` | Skill matrix |
| `learning_career_goals` | Career goal targets |
| `learning_ai_recommendations` | AI course recommendations |
| `learning_skill_assessments` | AI skill assessments |
| `learning_skill_gaps` | Cached skill gap analysis |
| `learning_role_matches` | Role matching results |
| `recruiter_kb_roles` | Knowledge Base roles |
| `recruiter_kb_certifications` | Knowledge Base certifications |

### AI Integration
- **Skill Assessment:** Gemini analyzes resume + certificates → skill matrix
- **Skill Gap Analysis:** Compares current skills vs target role requirements
- **Career Path Generation:** AI builds step-by-step learning path
- **Course Recommendations:** AI ranks courses by relevance to gaps
- **Promotion Readiness:** Predicts promotion eligibility
- **Certificate Skill Extraction:** AI reads certificate → extracts skills

---

## Career Framework

### Database Collections
| Collection | Purpose |
|-----------|---------|
| `career_tracks` | Department-level career paths |
| `career_levels` | Individual levels with requirements |
| `employee_career_assignments` | Assigned career paths to employees |

### Career Track Structure
```
Department: AI
Track: AI Engineering
├── Level 1: Junior Solution Engineer/System Analyst
│   ├── Skills: Python (Intermediate), ML (Beginner)
│   ├── Certs: None
│   └── Courses: Python Fundamentals, Intro to ML
├── Level 2: Solution Engineer/System Analyst
│   ├── Skills: Python (Advanced), ML (Intermediate), TF (Beginner)
│   ├── Certs: Azure AI Fundamentals (AI-900)
│   └── Courses: Advanced Python, ML Deep Dive, Azure AI
└── Level 3: Senior Solution Engineer/System Analyst
    ├── Skills: Python (Expert), ML (Advanced), DL (Intermediate)
    ├── Certs: Azure AI Engineer Associate
    └── Courses: Deep Learning, Azure AI Engineer
```

### Progress Calculation
```
Readiness Score = (Completed Courses + Acquired Skills + Earned Certifications)
                  / (Total Required Courses + Total Required Skills + Total Required Certifications)
                  × 100
```

### API Endpoints
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/career-framework/tracks` | GET/POST | List/Create career tracks |
| `/api/career-framework/tracks/{id}` | GET/PUT/DELETE | Track CRUD |
| `/api/career-framework/levels` | GET/POST | List/Create career levels |
| `/api/career-framework/levels/{id}` | GET/PUT/DELETE | Level CRUD |
| `/api/career-framework/employees/{id}/assign` | POST | Assign career path |
| `/api/career-framework/employees/{id}` | GET/PUT | Get/Update assignment |
| `/api/career-framework/employees/{id}/discussion` | POST | Log career discussion |
| `/api/career-framework/bulk-assign` | POST | Bulk assign paths |
| `/api/career-framework/assignments` | GET | List all assignments |
| `/api/career-framework/my-career` | GET | Employee self-service |
| `/api/career-framework/my-career/progress` | GET | Employee progress |
| `/api/career-framework/reports/promotion-readiness` | GET | Promotion report |
| `/api/career-framework/reports/career-progress` | GET | Department progress |
| `/api/career-framework/export` | GET | Export CSV |
| `/api/career-framework/import` | POST | Import CSV |
| `/api/career-framework/template` | GET | Download template |

---

## Technical Architecture

### Backend Structure
```
backend/app/
├── api/              # FastAPI routers (endpoints)
│   ├── auth.py
│   ├── career_framework.py  # NEW
│   ├── learning.py
│   ├── employees.py
│   └── ...
├── core/             # Core modules
│   ├── config.py
│   ├── database.py
│   ├── rbac.py
│   └── security.py
├── schemas/          # Pydantic models
│   ├── career_framework.py  # NEW
│   ├── learning.py
│   └── ...
├── services/         # Business logic
│   ├── career_framework_service.py  # NEW
│   ├── learning_service.py
│   ├── managed_learning_service.py
│   └── ...
└── main.py           # App entry point
```

### Frontend Structure
```
frontend/
├── app/dashboard/
│   ├── recruiter/
│   │   ├── learning/      # Learning + Career Framework tabs
│   │   ├── employees/
│   │   ├── candidates/
│   │   └── ...
│   ├── employee/
│   │   ├── learning/      # Employee learning
│   │   ├── career/        # NEW - Employee career path
│   │   └── ...
│   └── super-admin/
├── components/
│   └── recruiter/
│       ├── RecruiterShell.js
│       └── recruiterNav.js
├── services/
│   ├── careerService.js   # NEW
│   ├── learningService.js
│   └── ...
└── utils/
    └── employeeNav.js     # Updated with career nav
```

### Key Design Patterns
- **Service Layer:** Business logic in `*_service.py` files
- **Router Pattern:** FastAPI routers with dependency injection
- **Capability-Based Access:** Modules gated by recruiter capabilities
- **Caching:** AI results cached in MongoDB with hash-based invalidation
- **Event-Driven:** Notifications via `create_notification()`
- **Audit Logging:** All actions logged to `audit_logs` collection

---

## Known Issues & Gaps

### Security
- [ ] Capabilities not enforced on backend endpoints (only checked in frontend)
- [ ] No organization-level data isolation for recruiters
- [ ] Session capabilities don't sync on refresh

### LMS
- [ ] No learning paths/curricula (only individual courses)
- [ ] No compliance tracking with deadlines
- [ ] No certificate expiration tracking
- [ ] No learning budget management
- [ ] No manager approval workflow for learning requests

### Career Framework
- [ ] No employee self-initiated career requests
- [ ] No succession planning features
- [ ] No cross-department career moves tracking
- [ ] No salary band integration per level
- [ ] No competency assessment scoring (only defined, not assessed)

### Analytics
- [ ] No trend analysis over time
- [ ] No predictive analytics
- [ ] No ROI metrics for learning investment
- [ ] Limited export capabilities

---

## Recent Changes (This Session)

### Career Framework Implementation
1. **Backend:**
   - `schemas/career_framework.py` — Pydantic models
   - `services/career_framework_service.py` — Business logic (1175 lines)
   - `api/career_framework.py` — 23 API endpoints
   - `core/database.py` — Added indexes for new collections
   - `main.py` — Registered career framework router

2. **Frontend:**
   - `services/careerService.js` — API client
   - `app/dashboard/recruiter/learning/page.js` — Added Career Framework + Promotion Readiness tabs
   - `app/dashboard/employee/career/page.js` — Employee career view
   - `components/recruiter/recruiterNav.js` — Removed separate nav item (merged into Learning)
   - `utils/employeeNav.js` — Added "My Career" nav item

3. **Bug Fix:**
   - Fixed `managed_learning_service.analytics()` import error in `learning_service.py`
