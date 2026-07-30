"""FastAPI entrypoint for the read-only dashboard API."""

from pathlib import Path

from fastapi import Depends, FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .schemas import DashboardResponse, HealthResponse
from .service import DashboardService, dashboard_service


app = FastAPI(
    title="Agent Cost Dashboard API",
    version="2.0.0",
    description="Read-only analytics contract for the dashboard frontend.",
)


def get_dashboard_service() -> DashboardService:
    return dashboard_service


@app.get("/api/v2/health", response_model=HealthResponse, tags=["system"])
def health() -> HealthResponse:
    return HealthResponse()


@app.get("/api/v2/dashboard", response_model=DashboardResponse, tags=["dashboard"])
def dashboard(
    service: DashboardService = Depends(get_dashboard_service),
) -> DashboardResponse:
    return service.dashboard()


FRONTEND_DIST = Path(__file__).resolve().parents[1] / "frontend" / "dist"
if FRONTEND_DIST.is_dir():
    app.mount(
        "/assets",
        StaticFiles(directory=FRONTEND_DIST / "assets"),
        name="frontend-assets",
    )

    @app.get("/", include_in_schema=False)
    @app.get("/projects", include_in_schema=False)
    @app.get("/jira", include_in_schema=False)
    @app.get("/models", include_in_schema=False)
    def frontend() -> FileResponse:
        """Serve the built React SPA while keeping legacy port 8753 untouched."""
        return FileResponse(FRONTEND_DIST / "index.html")
