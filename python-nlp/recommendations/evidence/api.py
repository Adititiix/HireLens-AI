"""
FastAPI router for POST /resume-suggestions.

`create_router(get_engine)` lets app.py inject the shared engine (one embedder,
loaded once at startup) and lets tests inject one with a fake embedder.
Errors never echo resume content, file paths or stack traces to the client.
"""
import logging
import traceback
from typing import Callable

from fastapi import APIRouter, HTTPException

from .models import SuggestRequest, SuggestResponse

logger = logging.getLogger("resumeiq.suggestions")


def create_router(get_engine: Callable) -> APIRouter:
    router = APIRouter()

    # Plain `def`: FastAPI runs it in a worker thread, so CPU-bound embedding doesn't block the event loop.
    @router.post("/resume-suggestions", response_model=SuggestResponse)
    def resume_suggestions(req: SuggestRequest):
        try:
            return get_engine().suggest(req)
        except Exception as e:  # noqa: BLE001
            # Log the exception type and code location only — the message could contain resume text.
            logger.error("resume-suggestions failed: %s\n%s", type(e).__name__, "".join(traceback.format_tb(e.__traceback__)))
            raise HTTPException(status_code=500, detail="Could not generate suggestions.")

    return router
