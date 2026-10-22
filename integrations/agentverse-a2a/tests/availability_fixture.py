"""Public projection shape from SDS a10ef6f3; no restoration evidence copied."""

STATUS_URL = "https://samedaydesk.com/discovery/paid-gateway.json"


def availability_body(state="available"):
    return {
        "origin": "https://agents.samedaydesk.com",
        "state": state,
        "callable": state == "available",
        "observedAt": "2026-10-22T21:10:00.000Z" if state == "available" else "2026-10-22T01:50:00.000Z",
        "summary": "Paid gateway status.",
        "nextAction": "https://samedaydesk.com/discovery/useful-jobs.json",
        "alternatives": {
            "freeApexMcp": "https://samedaydesk.com/mcp",
            "offlinePackages": "https://samedaydesk.com/discovery/useful-jobs.json",
            "originalTask": "https://samedaydesk.com/discovery/original-task-correspondence.json",
        },
        "preservation": "Acquired packages remain usable offline.",
    }
