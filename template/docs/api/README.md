# API

API reference lives beside its implementation (ADR-0004). This directory holds only
cross-cutting API conventions: error shape, pagination, versioning.

The concrete reference is the backend's generated OpenAPI document, served at `/api/docs`
outside production (see `apps/backend/README.md`).
