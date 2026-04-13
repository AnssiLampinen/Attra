import os
import secrets
from dataclasses import asdict
from datetime import datetime, timezone
from typing import Any

from supabase_client import supabase


DEFAULT_TENANT_ID = os.getenv("CRM_DEFAULT_TENANT_ID", "default")
DEFAULT_TENANT_NAME = os.getenv("CRM_DEFAULT_TENANT_NAME", "Default tenant")
DEFAULT_TENANT_API_KEY = os.getenv("CRM_DEFAULT_API_KEY")


def initialize_database() -> dict[str, str | bool]:
    """Ensure the default tenant exists. Tables must already exist in Supabase."""
    result = (
        supabase.table("tenants")
        .select("id, api_key")
        .eq("id", DEFAULT_TENANT_ID)
        .limit(1)
        .execute()
    )

    if not result.data:
        api_key = DEFAULT_TENANT_API_KEY or secrets.token_urlsafe(32)
        supabase.table("tenants").insert(
            {
                "id": DEFAULT_TENANT_ID,
                "name": DEFAULT_TENANT_NAME,
                "api_key": api_key,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
        ).execute()
        return {
            "default_tenant_id": DEFAULT_TENANT_ID,
            "default_tenant_api_key": api_key,
            "created_default_tenant": True,
        }

    return {
        "default_tenant_id": DEFAULT_TENANT_ID,
        "default_tenant_api_key": result.data[0]["api_key"],
        "created_default_tenant": False,
    }


def create_tenant(
    name: str,
    tenant_id: str | None = None,
    api_key: str | None = None,
    supabase_user_id: str | None = None,
    username: str | None = None,
) -> dict[str, str]:
    tenant_identifier = tenant_id or secrets.token_urlsafe(12)
    tenant_api_key = api_key or secrets.token_urlsafe(32)

    payload: dict[str, Any] = {
        "id": tenant_identifier,
        "name": name,
        "api_key": tenant_api_key,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    if supabase_user_id:
        payload["supabase_user_id"] = supabase_user_id
    if username:
        payload["username"] = username

    supabase.table("tenants").insert(payload).execute()
    return {"tenant_id": tenant_identifier, "api_key": tenant_api_key, "name": name}


def update_tenant_settings(tenant_id: str, settings: dict) -> None:
    allowed = {"hide_personal_contacts", "username", "display_name"}
    data = {k: v for k, v in settings.items() if k in allowed}
    if data:
        supabase.table("tenants").update(data).eq("id", tenant_id).execute()


def get_tenant(tenant_id: str) -> dict | None:
    result = (
        supabase.table("tenants")
        .select("*")
        .eq("id", tenant_id)
        .limit(1)
        .execute()
    )
    return result.data[0] if result.data else None


def resolve_tenant_id_by_api_key(api_key: str) -> str | None:
    result = (
        supabase.table("tenants")
        .select("id")
        .eq("api_key", api_key)
        .limit(1)
        .execute()
    )
    return result.data[0]["id"] if result.data else None


def resolve_tenant_id_by_supabase_user_id(supabase_user_id: str) -> str | None:
    result = (
        supabase.table("tenants")
        .select("id")
        .eq("supabase_user_id", supabase_user_id)
        .limit(1)
        .execute()
    )
    return result.data[0]["id"] if result.data else None


def create_customer(tenant_id: str, payload: dict) -> dict:
    allowed = {
        "name", "phone", "email", "status", "notes", "customer_profile",
        "whatsapp_id", "instagram_id", "messenger_id", "telegram_id", "signal_id",
        "twitter_id", "linkedin_id", "slack_id", "discord_id",
        "google_messages_id", "google_chat_id", "google_voice_id", "pinned",
    }
    data = {k: v for k, v in payload.items() if k in allowed}
    data["tenant_id"] = tenant_id
    data.setdefault("status", "unknown")
    data["last_updated_at"] = datetime.now(timezone.utc).isoformat()
    result = supabase.table("customers").insert(data).execute()
    return result.data[0]


def create_deal(tenant_id: str, payload: dict) -> dict:
    allowed = {"title", "description", "amount", "status", "expected_close_date", "customer_id"}
    data = {k: v for k, v in payload.items() if k in allowed}
    data["tenant_id"] = tenant_id
    data.setdefault("status", "lead")
    now = datetime.now(timezone.utc).isoformat()
    data["created_at"] = now
    data["updated_at"] = now
    result = supabase.table("deals").insert(data).execute()
    return result.data[0]


def update_deal(tenant_id: str, deal_id: int, payload: dict) -> dict | None:
    allowed = {"title", "description", "amount", "status", "expected_close_date", "closed_at"}
    data = {k: v for k, v in payload.items() if k in allowed}
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    result = (
        supabase.table("deals")
        .update(data)
        .eq("tenant_id", tenant_id)
        .eq("id", deal_id)
        .execute()
    )
    return result.data[0] if result.data else None


def get_tags_for_tenant(tenant_id: str) -> list[dict]:
    result = (
        supabase.table("tags")
        .select("id, name")
        .eq("tenant_id", tenant_id)
        .order("name")
        .execute()
    )
    return result.data or []


def create_tag(tenant_id: str, name: str) -> dict:
    result = supabase.table("tags").insert({"tenant_id": tenant_id, "name": name}).execute()
    return result.data[0]


def load_customer_tags_for_tenant(tenant_id: str) -> dict:
    """Return {customer_id: [tag_name, ...]} for all customers of a tenant."""
    tags_result = (
        supabase.table("tags")
        .select("id")
        .eq("tenant_id", tenant_id)
        .execute()
    )
    tenant_tag_ids = [t["id"] for t in (tags_result.data or [])]
    if not tenant_tag_ids:
        return {}
    ct_result = (
        supabase.table("customer_tags")
        .select("customer_id, tag_id, tags(name)")
        .in_("tag_id", tenant_tag_ids)
        .execute()
    )
    mapping: dict = {}
    for row in (ct_result.data or []):
        cid = int(row["customer_id"])
        name = (row.get("tags") or {}).get("name", "")
        if name:
            mapping.setdefault(cid, []).append(name)
    return mapping


def get_customer_tags(customer_id: int) -> list[dict]:
    result = (
        supabase.table("customer_tags")
        .select("tag_id, tags(id, name)")
        .eq("customer_id", customer_id)
        .execute()
    )
    return [
        {"id": r["tags"]["id"], "name": r["tags"]["name"]}
        for r in (result.data or [])
        if r.get("tags")
    ]


def set_customer_tags(customer_id: int, tag_ids: list[int]) -> None:
    supabase.table("customer_tags").delete().eq("customer_id", customer_id).execute()
    if tag_ids:
        supabase.table("customer_tags").insert(
            [{"customer_id": customer_id, "tag_id": tid} for tid in tag_ids]
        ).execute()


def update_customer(tenant_id: str, customer_id: int, payload: dict) -> dict | None:
    allowed = {
        "name", "phone", "email", "status", "notes", "profile_notes", "customer_profile",
        "whatsapp_id", "instagram_id", "messenger_id", "telegram_id", "signal_id",
        "twitter_id", "linkedin_id", "slack_id", "discord_id",
        "google_messages_id", "google_chat_id", "google_voice_id", "pinned",
    }
    data = {k: v for k, v in payload.items() if k in allowed}
    data["last_updated_at"] = datetime.now(timezone.utc).isoformat()
    result = (
        supabase.table("customers")
        .update(data)
        .eq("tenant_id", tenant_id)
        .eq("id", customer_id)
        .execute()
    )
    return result.data[0] if result.data else None


def load_deals_for_tenant(tenant_id: str) -> list[dict]:
    result = (
        supabase.table("deals")
        .select("*, customers(name)")
        .eq("tenant_id", tenant_id)
        .order("created_at", desc=True)
        .execute()
    )
    rows = result.data or []
    # Flatten nested customer name
    for row in rows:
        customer = row.pop("customers", None)
        row["customer_name"] = (customer or {}).get("name") or ""
    return rows


def load_customers_for_tenant(tenant_id: str) -> list[dict]:
    result = (
        supabase.table("customers")
        .select("*")
        .eq("tenant_id", tenant_id)
        .order("last_updated_at", desc=True)
        .execute()
    )
    return result.data or []


def find_customer(
    tenant_id: str,
    name: str,
    network_values: dict[str, str],
) -> int | None:
    """Find an existing customer by name or network ID. Returns the customer id or None."""
    if name:
        row = (
            supabase.table("customers")
            .select("id")
            .eq("tenant_id", tenant_id)
            .eq("name", name)
            .limit(1)
            .execute()
        )
        if row.data:
            return int(row.data[0]["id"])

    for column, value in network_values.items():
        if not value:
            continue
        row = (
            supabase.table("customers")
            .select("id")
            .eq("tenant_id", tenant_id)
            .eq(column, value)
            .limit(1)
            .execute()
        )
        if row.data:
            return int(row.data[0]["id"])

    return None


def get_customer(tenant_id: str, customer_id: int) -> dict | None:
    result = (
        supabase.table("customers")
        .select("*")
        .eq("tenant_id", tenant_id)
        .eq("id", customer_id)
        .limit(1)
        .execute()
    )
    return result.data[0] if result.data else None


def upsert_customer_payload(tenant_id: str, payload: dict[str, Any]) -> int:
    """Insert or update a customer row.

    If 'id' is present in payload the row is updated; otherwise Supabase
    auto-generates the id. Returns the customer id.
    """
    data = dict(payload)
    data["tenant_id"] = tenant_id

    result = supabase.table("customers").upsert(data, on_conflict="id").execute()
    return int(result.data[0]["id"])


def save_customer(customer: Any, tenant_id: str | None = None) -> None:
    """Save a Customer dataclass instance to Supabase."""
    tenant_identifier = tenant_id or getattr(customer, "tenant_id", DEFAULT_TENANT_ID)
    messages = getattr(customer, "messages", [])

    payload: dict[str, Any] = {
        "tenant_id": tenant_identifier,
        "name": customer.name,
        "phone": getattr(customer, "phone", ""),
        "email": getattr(customer, "email", ""),
        "status": getattr(customer, "status", "unknown"),
        "summary": getattr(customer, "summary", ""),
        "last_updated_at": datetime.now(timezone.utc).isoformat(),
        "whatsapp_id": getattr(customer, "whatsapp_id", ""),
        "instagram_id": getattr(customer, "instagram_id", ""),
        "messenger_id": getattr(customer, "messenger_id", ""),
        "telegram_id": getattr(customer, "telegram_id", ""),
        "signal_id": getattr(customer, "signal_id", ""),
        "twitter_id": getattr(customer, "twitter_id", ""),
        "linkedin_id": getattr(customer, "linkedin_id", ""),
        "slack_id": getattr(customer, "slack_id", ""),
        "discord_id": getattr(customer, "discord_id", ""),
        "google_messages_id": getattr(customer, "google_messages_id", ""),
        "google_chat_id": getattr(customer, "google_chat_id", ""),
        "google_voice_id": getattr(customer, "google_voice_id", ""),
        "messages": str([asdict(m) for m in messages]),
    }

    supabase.table("customers").upsert(payload, on_conflict="id").execute()


# ---------------------------------------------------------------------------
# Raw messages staging (Beeper → Supabase → LLM processor)
# ---------------------------------------------------------------------------

def insert_raw_message_batch(
    tenant_id: str,
    customer_id: int,
    messages: list[dict],
    latest_message_id: str,
) -> int:
    """Store a raw message batch for later LLM processing. Returns the new row id."""
    result = supabase.table("raw_messages").insert({
        "tenant_id": tenant_id,
        "customer_id": customer_id,
        "messages": messages,
        "latest_message_id": latest_message_id,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "processed": False,
    }).execute()
    return int(result.data[0]["id"])


def get_latest_ingested_message_id(tenant_id: str, customer_id: int) -> str:
    """Return the latest_message_id of the most recently ingested batch for this customer."""
    result = (
        supabase.table("raw_messages")
        .select("latest_message_id")
        .eq("tenant_id", tenant_id)
        .eq("customer_id", customer_id)
        .order("fetched_at", desc=True)
        .limit(1)
        .execute()
    )
    return result.data[0]["latest_message_id"] if result.data else ""


def find_pending_batch_for_customer(tenant_id: str, customer_id: int) -> dict | None:
    """Return the newest unprocessed, unlocked batch for a specific customer, or None."""
    result = (
        supabase.table("raw_messages")
        .select("id, latest_message_id, messages")
        .eq("tenant_id", tenant_id)
        .eq("customer_id", customer_id)
        .eq("processed", False)
        .eq("processing", False)
        .order("fetched_at", desc=True)
        .limit(1)
        .execute()
    )
    return result.data[0] if result.data else None


def append_messages_to_batch(
    batch_id: int,
    new_messages: list[dict],
    new_latest_message_id: str,
) -> None:
    """Append new messages to an existing pending batch, deduplicating by message id."""
    result = (
        supabase.table("raw_messages")
        .select("messages")
        .eq("id", batch_id)
        .limit(1)
        .execute()
    )
    if not result.data:
        return
    existing_msgs: list[dict] = result.data[0]["messages"] or []
    existing_ids = {m.get("id") for m in existing_msgs if m.get("id")}
    to_append = [m for m in new_messages if m.get("id") not in existing_ids]
    supabase.table("raw_messages").update({
        "messages": existing_msgs + to_append,
        "latest_message_id": new_latest_message_id,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", batch_id).execute()


def fetch_oldest_unprocessed_batch(tenant_id: str | None = None) -> dict | None:
    """Return the oldest unprocessed, unlocked raw_messages row, across all tenants by default.

    Pass tenant_id to restrict to a single tenant.
    """
    query = (
        supabase.table("raw_messages")
        .select("*")
        .eq("processed", False)
        .eq("processing", False)
        .order("fetched_at")
        .limit(1)
    )
    if tenant_id:
        query = query.eq("tenant_id", tenant_id)
    result = query.execute()
    return result.data[0] if result.data else None


def mark_batch_processing(batch_id: int) -> None:
    """Lock a batch so the ingest script won't append to it while the LLM is running."""
    result = supabase.table("raw_messages").update({"processing": True}).eq("id", batch_id).execute()
    if not result.data:
        raise RuntimeError(
            f"mark_batch_processing: update returned no data for batch_id={batch_id}. "
            "Check that the 'processing' column exists (run: ALTER TABLE raw_messages ADD COLUMN processing BOOLEAN NOT NULL DEFAULT FALSE)."
        )


def get_all_customer_events(tenant_id: str) -> list[dict]:
    result = (
        supabase.table("customer_events")
        .select("id, title, event_date, event_time, customer_id, customers(name)")
        .eq("tenant_id", tenant_id)
        .order("event_date")
        .execute()
    )
    rows = result.data or []
    for row in rows:
        customer = row.pop("customers", None)
        row["customer_name"] = (customer or {}).get("name") or ""
    return rows


def get_customer_events(tenant_id: str, customer_id: int) -> list[dict]:
    result = (
        supabase.table("customer_events")
        .select("id, title, event_date, event_time, duration_minutes, notes")
        .eq("tenant_id", tenant_id)
        .eq("customer_id", customer_id)
        .order("event_date")
        .execute()
    )
    return result.data or []


def create_customer_event(tenant_id: str, customer_id: int, payload: dict) -> dict:
    allowed = {"title", "event_date", "event_time", "duration_minutes", "notes"}
    data = {k: v for k, v in payload.items() if k in allowed}
    now = datetime.now(timezone.utc).isoformat()
    data["tenant_id"] = tenant_id
    data["customer_id"] = customer_id
    data["created_at"] = now
    data["updated_at"] = now
    result = supabase.table("customer_events").insert(data).execute()
    return result.data[0]


def delete_customer_event(tenant_id: str, event_id: int) -> bool:
    result = (
        supabase.table("customer_events")
        .delete()
        .eq("tenant_id", tenant_id)
        .eq("id", event_id)
        .execute()
    )
    return bool(result.data)


def mark_batch_processed(batch_id: int) -> None:
    """Overwrite message content (data hygiene) then delete the row."""
    supabase.table("raw_messages").update({"messages": []}).eq("id", batch_id).execute()
    supabase.table("raw_messages").delete().eq("id", batch_id).execute()
