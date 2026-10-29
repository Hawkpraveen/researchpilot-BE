"""Build-time contract check for the agent revision pinned by this repository.

Uses an in-memory model transport: no credentials, database, model or network.
"""
import asyncio
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "agent"))

import httpx
from app.models.execution import ProviderConfig
from app.services.research_providers import generate_json


async def check():
    def model_endpoint(request):
        if request.headers.get("Authorization") != "Bearer compatibility-probe":
            raise RuntimeError(
                "The pinned agent cannot authenticate connector model requests. "
                "Update the backend's agent Git submodule to the published connector revision."
            )
        return httpx.Response(200, json={"message": {"content": "{}"}})

    provider = ProviderConfig(
        mode="local", provider="ollama", endpoint="http://127.0.0.1:5000/api/v1/connectors/relay",
        model="compatibility-probe", apiKey="compatibility-probe",
    )
    async with httpx.AsyncClient(transport=httpx.MockTransport(model_endpoint)) as client:
        await generate_json(client, provider, "probe", "probe", {}, 1)


if __name__ == "__main__":
    asyncio.run(check())
    print("Agent connector authentication compatibility verified.")
