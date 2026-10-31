"""
ValoraA - FastAPI Application Entrypoint for Vercel
Exports the main FastAPI application instance for Vercel's FastAPI runtime.
"""
from services.api.main import app

__all__ = ["app"]
