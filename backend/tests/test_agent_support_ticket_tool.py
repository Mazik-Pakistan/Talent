from app.services.agent_tools import _build_support_ticket_request


def test_build_support_ticket_request_normalizes_issue_details() -> None:
    payload = _build_support_ticket_request(
        {
            "title": "Login issue",
            "details": "I could not sign in from the recruiter dashboard",
            "issue_type": "login_issue",
            "module": "dashboard",
            "priority": "critical",
            "browser": "Chrome",
            "os": "Windows",
        }
    )

    assert payload["subject"] == "Login issue"
    assert payload["description"] == "I could not sign in from the recruiter dashboard"
    assert payload["category"] == "login_issue"
    assert payload["affected_module"] == "dashboard"
    assert payload["priority"] == "critical"
    assert payload["browser"] == "Chrome"
    assert payload["os"] == "Windows"
