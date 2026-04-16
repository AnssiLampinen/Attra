"""
database.py

All Supabase query functions used across the project. Imported by every
runnable script — not a runnable script itself.

Functional areas:

  Tenants
    initialize_database()       — ensures a default tenant exists on first run
    create_tenant(...)          — creates a new tenant row
    get_tenant(tenant_id)       — fetches tenant settings dict
    update_tenant_settings(...) — patches allowed fields on the tenants row
    resolve_tenant_id_by_api_key(key)
    resolve_tenant_id_by_supabase_user_id(uid)

  Customers
    create_customer / update_customer / upsert_customer_payload
    load_customers_for_tenant   — full list for the UI
    find_customer(...)          — lookup by name + network identifiers
    get_customer(tenant_id, id) — single customer by ID
    soft_delete_customer(...)   — sets status to 'deleted'
    is_customer_deleted(id)
    queue_customer_refresh(...) — sets needs_refresh flag + clears AI fields
    clear_customer_needs_refresh(...)
    get_recent_messages_for_customer(...)

  Deals
    create_deal / update_deal / load_deals_for_tenant

  Tags
    create_tag / update_tag / delete_tag
    get_tags_for_tenant
    get_customer_tags / set_customer_tags / load_customer_tags_for_tenant

  Events (timeline entries)
    create_customer_event / delete_customer_event
    get_customer_events / get_all_customer_events

  Raw messages (staging queue)
    insert_raw_message_batch(...)   — creates a new batch for the LLM worker
    append_messages_to_batch(...)   — merges new messages into a pending batch
    find_pending_batch_for_customer(...) — checks for an existing open batch
    fetch_oldest_unprocessed_batch() — used by process_raw_messages.py
    mark_batch_processing(id)       — locks a batch to prevent double-processing
    mark_batch_processed(id)        — marks completion
    get_latest_ingested_message_id(...)
"""

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
    allowed = {"hide_personal_contacts", "username", "display_name", "voice_note_append_to_notes"}
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


def resolve_tenant_id_from_env() -> str:
    """Resolve tenant ID from CRM_TENANT_ID or CRM_TENANT_API_KEY env vars."""
    api_key = os.getenv("CRM_TENANT_API_KEY")
    return os.getenv("CRM_TENANT_ID") or (
        resolve_tenant_id_by_api_key(api_key) if api_key else DEFAULT_TENANT_ID
    )


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
        "name", "display_name", "phone", "email", "status", "notes", "customer_profile",
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
        .select("id, name, color")
        .eq("tenant_id", tenant_id)
        .order("name")
        .execute()
    )
    return result.data or []


def create_tag(tenant_id: str, name: str, color: str | None = None) -> dict:
    row: dict = {"tenant_id": tenant_id, "name": name}
    if color:
        row["color"] = color
    result = supabase.table("tags").insert(row).execute()
    return result.data[0]


def update_tag(tenant_id: str, tag_id: int, name: str, color: str | None) -> dict | None:
    data: dict = {"name": name}
    data["color"] = color  # allow clearing color by setting None
    result = (
        supabase.table("tags")
        .update(data)
        .eq("tenant_id", tenant_id)
        .eq("id", tag_id)
        .execute()
    )
    return result.data[0] if result.data else None


def delete_tag(tenant_id: str, tag_id: int) -> None:
    # Remove customer associations first (in case no CASCADE constraint)
    supabase.table("customer_tags").delete().eq("tag_id", tag_id).execute()
    supabase.table("tags").delete().eq("tenant_id", tenant_id).eq("id", tag_id).execute()


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
        .select("tag_id, tags(id, name, color)")
        .eq("customer_id", customer_id)
        .execute()
    )
    return [
        {"id": r["tags"]["id"], "name": r["tags"]["name"], "color": r["tags"].get("color")}
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
        "name", "display_name", "phone", "email", "status", "notes", "profile_notes", "customer_profile",
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
    """Find an existing customer by network ID or name. Returns the customer id or None."""
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

    if name:
        for col in ("name", "display_name"):
            row = (
                supabase.table("customers")
                .select("id")
                .eq("tenant_id", tenant_id)
                .eq(col, name)
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


def is_customer_deleted(customer_id: int) -> bool:
    """Return True if the customer's status is 'deleted'."""
    result = (
        supabase.table("customers")
        .select("status")
        .eq("id", customer_id)
        .limit(1)
        .execute()
    )
    if result.data:
        return (result.data[0].get("status") or "").lower() == "deleted"
    return False


def soft_delete_customer(tenant_id: str, customer_id: int) -> None:
    """Soft-delete: set status to 'deleted' and clear all notes fields."""
    supabase.table("customers").update({
        "status": "deleted",
        "summary": "",
        "profile_notes": "",
        "customer_profile": "",
        "notes": "",
    }).eq("tenant_id", tenant_id).eq("id", customer_id).execute()


NETWORK_ID_COLUMNS = [
    "whatsapp_id", "instagram_id", "messenger_id", "telegram_id", "signal_id",
    "twitter_id", "linkedin_id", "slack_id", "discord_id",
    "google_messages_id", "google_chat_id", "google_voice_id",
]


def transfer_events_to_customer(
    tenant_id: str, from_customer_id: int, to_customer_id: int
) -> None:
    """Bulk-reassign all events from one customer to another."""
    supabase.table("customer_events") \
        .update({"customer_id": to_customer_id}) \
        .eq("tenant_id", tenant_id) \
        .eq("customer_id", from_customer_id) \
        .execute()


def merge_customers(tenant_id: str, primary: dict, secondary: dict) -> dict:
    """Merge secondary into primary. Returns updated primary row.

    Operation order (safe for non-atomic Supabase):
      1. Build update dict in Python (no DB writes yet)
      2. UPDATE primary fields
      3. Bulk-reassign events to primary
      4. Union tags onto primary
      5. Soft-delete secondary
      6. Set needs_refresh=True on primary (LLM will clean up combined profile_notes)
    """
    primary_id = int(primary["id"])
    secondary_id = int(secondary["id"])

    update: dict[str, Any] = {}

    # Network IDs: fill primary gaps from secondary
    for col in NETWORK_ID_COLUMNS:
        if not (primary.get(col) or "").strip() and (secondary.get(col) or "").strip():
            update[col] = secondary[col]

    # Phone / email: fill primary gaps
    for col in ("phone", "email"):
        if not (primary.get(col) or "").strip() and (secondary.get(col) or "").strip():
            update[col] = secondary[col]

    # notes and profile_notes: concatenate
    for col in ("notes", "profile_notes"):
        pval = (primary.get(col) or "").rstrip()
        sval = (secondary.get(col) or "").strip()
        if sval:
            update[col] = (pval + "\n\n---\n\n" + sval) if pval else sval

    if update:
        update_customer(tenant_id, primary_id, update)

    transfer_events_to_customer(tenant_id, secondary_id, primary_id)

    primary_tag_ids = {t["id"] for t in get_customer_tags(primary_id)}
    secondary_tag_ids = {t["id"] for t in get_customer_tags(secondary_id)}
    set_customer_tags(primary_id, list(primary_tag_ids | secondary_tag_ids))

    soft_delete_customer(tenant_id, secondary_id)

    # Set needs_refresh directly — do NOT use queue_customer_refresh() which would
    # clear the just-concatenated profile_notes
    supabase.table("customers").update({
        "needs_refresh": True,
        "last_updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("tenant_id", tenant_id).eq("id", primary_id).execute()

    return get_customer(tenant_id, primary_id)


def get_recent_messages_for_customer(
    tenant_id: str, customer_id: int, limit: int = 50
) -> list[dict]:
    """Return up to `limit` recent messages for a customer from raw_messages batches.

    Batches are fetched oldest-first so messages are in roughly chronological order.
    """
    result = (
        supabase.table("raw_messages")
        .select("messages, fetched_at")
        .eq("tenant_id", tenant_id)
        .eq("customer_id", customer_id)
        .order("fetched_at")
        .execute()
    )
    all_msgs: list[dict] = []
    for row in (result.data or []):
        all_msgs.extend(row["messages"] or [])
    return all_msgs[-limit:] if len(all_msgs) > limit else all_msgs


def queue_customer_refresh(tenant_id: str, customer_id: int) -> dict | None:
    """Clear AI fields, reset last_processed_message_id, and set needs_refresh=True so
    the next ingest cycle re-fetches 50 messages and re-runs the LLM pipeline."""
    data = {
        "customer_profile": "",
        "profile_notes": "",
        "summary": "",
        "last_processed_message_id": None,
        "needs_refresh": True,
        "last_updated_at": datetime.now(timezone.utc).isoformat(),
    }
    result = (
        supabase.table("customers")
        .update(data)
        .eq("tenant_id", tenant_id)
        .eq("id", customer_id)
        .execute()
    )
    return result.data[0] if result.data else None


def clear_customer_needs_refresh(tenant_id: str, customer_id: int) -> None:
    """Clear the needs_refresh flag after the ingest script has queued the batch."""
    supabase.table("customers").update({"needs_refresh": False}).eq("tenant_id", tenant_id).eq("id", customer_id).execute()


def create_feedback(tenant_id: str, category: str, message: str) -> dict:
    row = {
        "tenant_id": tenant_id,
        "category": category,
        "message": message,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    result = supabase.table("feedback").insert(row).execute()
    return result.data[0]
