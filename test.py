import requests
import json

def search_hubspot(query):
    url = "https://45bwzj1sgc-dsn.algolia.net/1/indexes/*/queries"

    headers = {
        "X-Algolia-API-Key": "YOUR_PUBLIC_SEARCH_KEY",
        "X-Algolia-Application-Id": "45BWZJ1SGC",
        "Content-Type": "application/json"
    }

    payload = {
        "requests": [
            {
                "indexName": "academy_prod",
                "params": f"query={query}&hitsPerPage=10"
            }
        ]
    }

    r = requests.post(url, headers=headers, json=payload)

    print(r.status_code)
    print(json.dumps(r.json(), indent=2))


search_hubspot("communication")